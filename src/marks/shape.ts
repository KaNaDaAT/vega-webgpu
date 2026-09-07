import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { PathGeometry } from '../types/geometry.js';
import type { SceneShapeItem } from '../types/scene.js';
import { shape } from '../path/shapes.js';
import geometryForItem from '../path/geometryForItem.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import type { Point } from '../util/dash.js';
import { Color, isGradient, type RGBA } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  GeometryBatch,
  SEGMENT_LAYOUT,
  SEGMENT_STRIDE,
  segmentCount,
  writeSegments,
  geometryVertexData,
  getMarkResources,
  enqueueGradient,
  type GradientTarget,
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
  /** Contours the outline is built from, so a hit never re-runs the shape generator. */
  lines: Point[][];
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
  /** Reused between frames so an outline never reallocates. */
  outlines: OutlineBuffer;
  /**
   * Per scene, because resources are shared by every mark of a type while the
   * render queue runs their draws at the end of the frame. One buffer between
   * them would leave every draw reading whichever mark wrote last.
   */
  outlineState: WeakMap<GPUVegaScene, OutlineState>;
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
      outlines: new OutlineBuffer(),
      outlineState: new WeakMap(),
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
  const gradientTarget: GradientTarget = {
    ctx,
    device,
    name: `${drawName}Gradient`,
    pipeline: res.gradientPipeline,
    bufferManager: res.bufferManager,
    uniformBuffer,
    vertexLength,
    clip,
  };

  // Solid fills and strokes share one pipeline and are accumulated in paint
  // order into a single buffer/draw. Gradient fills interrupt the batch.
  const batch = new GeometryBatch();
  // one batch draws with one pipeline, so a change of blend closes it
  let batchBlend = 'normal';
  // Outlines accumulate separately and draw after the fills. A sub pixel
  // stroke on a triangulated ribbon takes its coverage from MSAA, which can
  // only express quarter steps, so a 0.2 px country border came out patchy.
  const outlines = res.outlines;
  outlines.length = 0;
  // An outline only has to be rebuilt when something it is drawn from moved or
  // changed colour, which on a stroked choropleth is the difference between
  // rewriting a few hundred thousand segments a frame and rewriting none.
  let outlinesHeld = true;
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
    const [fillData, strokeData, lines, unchanged] = createGeometryData(
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
      enqueueGradient(gradientTarget, fillData, gradient, bounds);
    } else {
      batch.push(fillData);
    }
    if (strokeData.length > 0 && strokeGradient && bounds) {
      flushBatch();
      enqueueGradient(gradientTarget, strokeData, strokeGradient, bounds);
    } else {
      batch.push(strokeData);
      outlinesHeld &&= unchanged;
      pushOutline(outlines, item, lines);
    }
  }
  flushBatch();

  const state = res.outlineState.get(scene) ?? { buffer: null, capacity: 0, length: -1 };
  res.outlineState.set(scene, state);
  const heldOutline = outlinesHeld && outlines.length === state.length && state.buffer !== null;
  state.length = outlines.length;

  if (outlines.length > 0) {
    ctx._renderQueue.enqueue({
      pipeline: res.segmentPipeline,
      drawCounts: [6, outlines.length / SEGMENT_STRIDE],
      vertexBuffers: [outlineBuffer(device, state, outlines, heldOutline)],
      bindGroups: [createUniformBindGroup(`${drawName}Stroke`, device, res.segmentPipeline, uniformBuffer)],
      clip,
    });
  }
}

/** Appends one item's outline, contour by contour, as segment instances. */
function pushOutline(out: OutlineBuffer, item: SceneShapeItem, lines: Point[][]): void {
  const width = item.strokeWidth ?? 1;
  if (!item.stroke || width <= 0) {
    return;
  }
  const color = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
  if (color[3] <= 0) {
    return;
  }
  const needed = segmentCount(lines) * SEGMENT_STRIDE;
  if (needed === 0) {
    return;
  }
  out.length = writeSegments(out.reserve(needed), out.length, lines, color, width, CONTOUR_CAPS);
}

interface OutlineState {
  buffer: GPUBuffer | null;
  capacity: number;
  length: number;
}

/**
 * The scene's own outline buffer, rewritten only when the outline changed.
 * writeBuffer is ordered on the queue, so a rewrite lands after the previous
 * frame's draws have read it.
 */
function outlineBuffer(
  device: GPUDevice,
  state: OutlineState,
  outlines: OutlineBuffer,
  held: boolean,
): GPUBuffer {
  const bytes = new Uint8Array(outlines.data.buffer, 0, outlines.length * 4);
  if (state.buffer && held) {
    return state.buffer;
  }
  if (!state.buffer || state.capacity < bytes.byteLength) {
    let capacity = Math.max(bytes.byteLength, 4096);
    if (state.buffer) {
      capacity = Math.max(capacity, state.capacity * 2);
    }
    state.buffer = device.createBuffer({
      label: `${drawName} Outline`,
      size: capacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    state.capacity = capacity;
  }
  device.queue.writeBuffer(state.buffer, 0, bytes, 0, bytes.byteLength);
  return state.buffer;
}

/**
 * A float buffer the shape mark keeps between frames. Outlines run to hundreds
 * of thousands of segments on a stroked choropleth, so growing a plain array a
 * number at a time and converting it back cost more than everything else the
 * mark does.
 */
class OutlineBuffer {
  data = new Float32Array(0);
  length = 0;

  /** Room for `n` more floats, returning the buffer to write into. */
  reserve(n: number): Float32Array {
    if (this.length + n > this.data.length) {
      let size = Math.max(4096, this.data.length * 2);
      while (size < this.length + n) {
        size *= 2;
      }
      const grown = new Float32Array(size);
      grown.set(this.data.subarray(0, this.length));
      this.data = grown;
    }
    return this.data;
  }
}

/**
 * The item itself, which vega keeps across re-renders of the same tuple. A
 * datum id is not unique: a county split across several polygons is several
 * items sharing one id, and they would then share one entry.
 */
function cacheKey(item: SceneShapeItem): unknown {
  return item;
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
): [fillData: Float32Array, strokeData: Float32Array, lines: Point[][], unchanged: boolean] {
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
        return [entry.data[0], entry.data[1], entry.lines, true];
      }
      // geometry unchanged, rewrite only the colors
      const data: [Float32Array, Float32Array] = [
        new Float32Array(entry.data[0].length),
        new Float32Array(entry.data[1].length),
      ];
      recolor(data[0], entry.data[0], fill);
      recolor(data[1], entry.data[1], stroke);
      return [data[0], data[1], entry.lines, false];
    }
  }

  // the outline draws as segments, so the triangulation only builds the fill
  const shapeGeom = geom();
  const geometry = geometryForItem(ctx, strokeIsGradient ? item : { ...item, stroke: undefined }, shapeGeom);
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
      lines: shapeGeom.lines,
    });
  }
  return [data[0], data[1], shapeGeom.lines, false];
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
  return sameEdge(b.x1, snap.x1) && sameEdge(b.y1, snap.y1) && sameEdge(b.x2, snap.x2) && sameEdge(b.y2, snap.y2);
}

/**
 * A projection can send a shape outside its domain and leave NaN in the bounds,
 * which never equals itself, so those items would rebuild on every frame.
 */
function sameEdge(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

export default {
  type: 'shape',
  draw,
} satisfies MarkModule;
