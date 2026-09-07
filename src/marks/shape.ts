import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { PathGeometry } from '../types/geometry.js';
import type { SceneShapeItem } from '../types/scene.js';
import { shape } from '../path/shapes.js';
import geometryForItem from '../path/geometryForItem.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient, type RGBA } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  GeometryBatch,
  SEGMENT_LAYOUT,
  SEGMENT_STRIDE,
  segmentInstances,
  geometryVertexData,
  getMarkResources,
  gradientBounds,
  markClip,
  markPipeline,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Shape';
// Bounds the per-context geometry cache so a long streaming session, where
// every frame brings new datum ids, cannot grow it without limit.
const MAX_CACHE = 4096;

interface ShapeCacheEntry {
  fill: RGBA;
  stroke: RGBA;
  x?: number;
  y?: number;
  bounds?: BoundsSnapshot;
  strokeWidth?: number;
  strokeIsGradient: boolean;
  data: [Float32Array, Float32Array];
}

/** Every interior vertex of a contour gets a round join on the earlier end. */
const CONTOUR_CAPS = [0, 1] as const;

interface ShapeResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  pipelineFor: (blend: string) => GPURenderPipeline;
  gradientPipeline: GPURenderPipeline;
  /** Outlines draw as segments rather than a triangulated ribbon. */
  segmentVertexManager: VertexBufferManager;
  segmentPipeline: GPURenderPipeline;
  cache: Map<unknown, ShapeCacheEntry>;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): ShapeResources {
  return getMarkResources(ctx, 'shape', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x3', 'float32x4'], // position, color
      [],
    );
    const pipeline = markPipeline(ctx, device, drawName, 'SolidFill', vertexManager);
    // blend needs its own pipeline, and markPipeline caches them by mode
    const pipelineFor = (blend: string) =>
      blend === 'normal'
        ? pipeline
        : markPipeline(ctx, device, `${drawName} ${blend}`, 'SolidFill', vertexManager, undefined, blend);
    const gradientPipeline = markPipeline(ctx, device, `${drawName}Gradient`, 'GradientFill', vertexManager);
    const segmentVertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
    const segmentPipeline = markPipeline(ctx, device, `${drawName}Stroke`, 'SLine', segmentVertexManager);
    return {
      device,
      bufferManager,
      vertexManager,
      pipeline,
      pipelineFor,
      gradientPipeline,
      segmentVertexManager,
      segmentPipeline,
      cache: new Map(),
    };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as SceneShapeItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const useCache = ctx._renderer.wgOptions.cacheShapes ?? false;
  const clip = markClip(ctx, scene);
  const vertexLength = res.vertexManager.getVertexLength();

  // Solid fills and strokes share one pipeline and are accumulated in paint
  // order into a single buffer/draw. Gradient fills interrupt the batch.
  const batch = new GeometryBatch();
  // one batch draws with one pipeline, so a change of blend closes it
  let batchBlend = 'normal';
  // Outlines accumulate separately and draw after the fills. A sub pixel
  // stroke on a triangulated ribbon takes its coverage from MSAA, which can
  // only express quarter steps, so a 0.2 px country border came out patchy.
  const outlines: number[] = [];
  const flushBatch = () => {
    const data = batch.flush();
    if (data) {
      const pipeline = res.pipelineFor(batchBlend);
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [data.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(data)],
        bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer)],
        clip,
      });
    }
  };

  for (const item of items) {
    const blend = blendKey(item.blend);
    if (blend !== batchBlend) {
      flushBatch();
      batchBlend = blend;
    }
    const bounds = item.bounds;
    const gradient = isGradient(item.fill) && bounds ? item.fill : null;
    // A gradient stroke samples the ramp per fragment, which the segment shader
    // cannot do, so it keeps the triangulated ribbon and the gradient pipeline.
    const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
    let shapeGeom: PathGeometry | null = null;
    const geom = () => (shapeGeom ??= shape(ctx, item));
    const [fillData, strokeData] = createGeometryData(
      ctx,
      res,
      item,
      gradient !== null,
      strokeGradient !== null,
      useCache,
      geom,
    );

    if (fillData.length > 0 && gradient && bounds) {
      flushBatch();
      const gres = getGradientResources(device, ctx);
      ctx._renderQueue.enqueue({
        pipeline: res.gradientPipeline,
        drawCounts: [fillData.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
        bindGroups: [
          createUniformBindGroup(`${drawName}Gradient`, device, res.gradientPipeline, uniformBuffer),
          createGradientBindGroup(gres, res.gradientPipeline, gradient, gradientBounds(ctx, bounds)),
        ],
        clip,
      });
    } else {
      batch.push(fillData);
    }
    if (strokeData.length > 0 && strokeGradient && bounds) {
      flushBatch();
      const gres = getGradientResources(device, ctx);
      ctx._renderQueue.enqueue({
        pipeline: res.gradientPipeline,
        drawCounts: [strokeData.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
        bindGroups: [
          createUniformBindGroup(`${drawName}Gradient`, device, res.gradientPipeline, uniformBuffer),
          createGradientBindGroup(gres, res.gradientPipeline, strokeGradient, gradientBounds(ctx, bounds)),
        ],
        clip,
      });
    } else {
      batch.push(strokeData);
      pushOutline(outlines, item, geom);
    }
  }
  flushBatch();

  if (outlines.length > 0) {
    ctx._renderQueue.enqueue({
      pipeline: res.segmentPipeline,
      drawCounts: [6, outlines.length / SEGMENT_STRIDE],
      vertexBuffers: [res.bufferManager.createInstanceBuffer(Float32Array.from(outlines))],
      bindGroups: [createUniformBindGroup(`${drawName}Stroke`, device, res.segmentPipeline, uniformBuffer)],
      clip,
    });
  }
}

/** Appends one item's outline, contour by contour, as segment instances. */
function pushOutline(out: number[], item: SceneShapeItem, geom: () => PathGeometry): void {
  const width = item.strokeWidth ?? 1;
  if (!item.stroke || width <= 0) {
    return;
  }
  const color = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
  if (color[3] <= 0) {
    return;
  }
  const data = segmentInstances(geom().lines, color, width, CONTOUR_CAPS);
  if (data) {
    for (let i = 0; i < data.length; i++) {
      out.push(data[i]);
    }
  }
}

function cacheKey(item: SceneShapeItem): unknown {
  if (item.datum?.id != null) {
    return item.datum.id;
  }
  if (item.id != null) {
    return item.id;
  }
  // vega tuple ids are stored under a symbol property
  const symbols = Object.getOwnPropertySymbols(item);
  return symbols.length > 0 ? (item as unknown as Record<symbol, unknown>)[symbols[0]] : item;
}

function sameColor(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function recolor(data: Float32Array, source: Float32Array, color: RGBA): void {
  for (let i = 0; i < data.length; i += 7) {
    data[i] = source[i];
    data[i + 1] = source[i + 1];
    data[i + 2] = source[i + 2];
    data[i + 3] = color[0];
    data[i + 4] = color[1];
    data[i + 5] = color[2];
    data[i + 6] = color[3];
  }
}

function createGeometryData(
  ctx: GPUVegaCanvasContext,
  res: ShapeResources,
  item: SceneShapeItem,
  hasGradient: boolean,
  strokeIsGradient: boolean,
  useCache: boolean,
  geom: () => PathGeometry,
): [fillData: Float32Array, strokeData: Float32Array] {
  const key = cacheKey(item);
  const fill = hasGradient
    ? whiteCarrier(item.opacity, item.fillOpacity)
    : Color.from2(item.fill, item.opacity, item.fillOpacity);
  const stroke = strokeIsGradient
    ? whiteCarrier(item.opacity, item.strokeOpacity)
    : Color.from2(item.stroke, item.opacity, item.strokeOpacity);

  if (useCache) {
    const entry = res.cache.get(key);
    if (
      entry &&
      strokeIsGradient === entry.strokeIsGradient &&
      item.strokeWidth === entry.strokeWidth &&
      item.x === entry.x &&
      item.y === entry.y &&
      sameBounds(item.bounds, entry.bounds)
    ) {
      // re-insert to keep the map in least-recently-used order
      res.cache.delete(key);
      res.cache.set(key, entry);
      if (sameColor(entry.fill, fill) && sameColor(entry.stroke, stroke)) {
        return entry.data;
      }
      // geometry unchanged, rewrite only the colors
      const data: [Float32Array, Float32Array] = [
        new Float32Array(entry.data[0].length),
        new Float32Array(entry.data[1].length),
      ];
      recolor(data[0], entry.data[0], fill);
      recolor(data[1], entry.data[1], stroke);
      return data;
    }
  }

  // the outline draws as segments, so the triangulation only builds the fill
  const geometry = geometryForItem(ctx, strokeIsGradient ? item : { ...item, stroke: undefined }, geom());
  const data = geometryVertexData(geometry, fill, stroke);

  if (useCache) {
    if (res.cache.size >= MAX_CACHE) {
      const oldest = res.cache.keys().next().value;
      if (oldest !== undefined) {
        res.cache.delete(oldest);
      }
    }
    res.cache.set(key, {
      fill,
      stroke,
      x: item.x,
      y: item.y,
      bounds: copyBounds(item.bounds),
      strokeWidth: item.strokeWidth,
      strokeIsGradient,
      data,
    });
  }
  return data;
}

/**
 * Vega mutates a Bounds in place as the view pans or zooms, so comparing by
 * identity never sees a change. Snapshot the numbers and compare those.
 */
type BoundsSnapshot = { x1: number; y1: number; x2: number; y2: number };

function copyBounds(b?: Bounds): BoundsSnapshot | undefined {
  return b ? { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 } : undefined;
}

function sameBounds(b: Bounds | undefined, snap: BoundsSnapshot | undefined): boolean {
  if (b === undefined || snap === undefined) {
    return b === undefined && snap === undefined;
  }
  return b.x1 === snap.x1 && b.y1 === snap.y1 && b.x2 === snap.x2 && b.y2 === snap.y2;
}

export default {
  type: 'shape',
  draw,
} satisfies MarkModule;
