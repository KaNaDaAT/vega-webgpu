import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneGradient, SceneItem, SceneSymbolExt } from '../types/scene.js';
import geometryForItem from '../path/geometryForItem.js';
import { symbol as symbolShapeGeometry } from '../path/shapes.js';
import { DASH_FLATNESS } from '../path/geometryForPath.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { symbolSdfKey } from '../shaders/index.js';
import { hasSdf } from '../shaders/symbolSdf.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  outlinePipelines,
  type OutlinePipelines,
  dashPatternOf,
  enqueueOutline,
  strokeOutline,
  geometryVertexData,
  getMarkResources,
  gradientBounds,
  markClip,
  blendPipelines,
  markPipeline,
  strokeEnds,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Symbol';
// Bounds the triangulated-shape cache. `size` is continuous, so a size-encoded
// chart would otherwise mint a GPU buffer per distinct size, forever.
const MAX_SHAPE_CACHE = 256;

/** Cached triangulated fill/stroke geometry for one (shape, size, strokeWidth). */
interface ShapeGeometry {
  fill: GPUBuffer | null;
  fillCount: number;
  stroke: GPUBuffer | null;
  strokeCount: number;
}

interface SymbolResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  // Analytic circle path (crisp, the common scatter-plot case).
  circleVertexManager: VertexBufferManager;
  circlePipeline: GPURenderPipeline;
  circleGeometry: GPUBuffer;
  // Triangulated shapes, instanced per (shape, size).
  shapePipeline: GPURenderPipeline;
  shapePipelineFor: (blend: string) => GPURenderPipeline;
  shapeCache: Map<string, ShapeGeometry>;
  /** Pipelines for an outline drawn through the segment shader. */
  outline: OutlinePipelines;
  sdfVertexManager: VertexBufferManager;
  sdfPipelines: Map<string, GPURenderPipeline>;
  quadGeometry: GPUBuffer;
  // Per-vertex-colored triangles for gradient-filled symbols (rare, e.g. a
  // legend swatch): one non-instanced draw per item.
  colorVertexManager: VertexBufferManager;
  solidPipeline: GPURenderPipeline;
  gradientPipelineFor: (blend: string) => GPURenderPipeline;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): SymbolResources {
  return getMarkResources(ctx, 'symbol', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const circleVertexManager = new VertexBufferManager(
      ['float32x2'], // position
      // center, radius, fill color, stroke color, stroke width
      ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32'],
    );
    const circlePipeline = markPipeline(ctx, device, drawName, drawName, circleVertexManager);
    const shapeVertexManager = new VertexBufferManager(
      ['float32x2'], // geometry position (centered on origin)
      ['float32x2', 'float32x4', 'float32'], // instance center, color, angle
    );
    const shapePipeline = markPipeline(ctx, device, `${drawName}Shape`, 'SymbolShape', shapeVertexManager);
    const shapePipelineFor = blendPipelines(ctx, device, `${drawName}Shape`, 'SymbolShape', shapeVertexManager);
    const circleGeometry = bufferManager.createGeometryBuffer(createCircleGeometry(), undefined, true);
    const sdfVertexManager = new VertexBufferManager(
      ['float32x2'], // unit quad position
      // center, size, fill color, stroke color, stroke width, angle
      ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32', 'float32'],
    );
    const quadGeometry = bufferManager.createGeometryBuffer(
      Float32Array.from([-1, -1, -1, 1, 1, -1, 1, -1, -1, 1, 1, 1]),
      undefined,
      true,
    );
    const colorVertexManager = new VertexBufferManager(['float32x3', 'float32x4']); // position, color
    const solidPipeline = markPipeline(ctx, device, `${drawName}Solid`, 'SolidFill', colorVertexManager);
    // a dashed outline draws as segments, the way a dashed line and a dashed
    // group border already do
    const outline = outlinePipelines(ctx, device, `${drawName}Dash`);
    // a gradient fill under a blend needs its own pipeline too
    const gradientPipelineFor = blendPipelines(ctx, device, `${drawName}Gradient`, 'GradientFill', colorVertexManager);
    return {
      device,
      bufferManager,
      circleVertexManager,
      circlePipeline,
      circleGeometry,
      shapePipeline,
      shapePipelineFor,
      shapeCache: new Map(),
      outline,
      sdfVertexManager,
      sdfPipelines: new Map(),
      quadGeometry,
      colorVertexManager,
      solidPipeline,
      gradientPipelineFor,
    };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as SceneSymbolExt[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const clip = markClip(ctx, scene);

  let runKind: string | null = null;
  let run: SceneSymbolExt[] = [];
  let circleBindGroup: { group: GPUBindGroup; pipeline: GPURenderPipeline } | null = null;

  const flushRun = () => {
    if (run.length === 0 || runKind === null) {
      return;
    }
    const [kindPart, runBlend = 'normal'] = runKind.split('!');
    if (kindPart === 'circle') {
      const circlePipeline =
        runBlend === 'normal'
          ? res.circlePipeline
          : markPipeline(
              ctx,
              device,
              `${drawName} ${runBlend}`,
              drawName,
              res.circleVertexManager,
              undefined,
              runBlend,
            );
      // A bind group belongs to the layout it was made from, so a mark whose
      // items carry different blends cannot hold one across the change.
      if (circleBindGroup === null || circleBindGroup.pipeline !== circlePipeline) {
        circleBindGroup = {
          group: createUniformBindGroup(drawName, device, circlePipeline, uniformBuffer),
          pipeline: circlePipeline,
        };
      }
      const instanceBuffer = res.bufferManager.createInstanceBuffer(createCircleAttributes(run));
      ctx._renderQueue.enqueue({
        pipeline: circlePipeline,
        drawCounts: [6, run.length],
        vertexBuffers: [res.circleGeometry, instanceBuffer],
        bindGroups: [circleBindGroup.group],
        clip,
      });
    } else if (kindPart.startsWith('sdf|')) {
      const shape = kindPart.slice(4);
      const pipeline = sdfPipeline(device, ctx, res, shape, runBlend);
      const instanceBuffer = res.bufferManager.createInstanceBuffer(createSdfAttributes(run));
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [6, run.length],
        vertexBuffers: [res.quadGeometry, instanceBuffer],
        bindGroups: [createUniformBindGroup(`${drawName}Sdf`, device, pipeline, uniformBuffer)],
        clip,
      });
    } else {
      drawShapeGroup(device, ctx, res, uniformBuffer, kindPart, runBlend, run, clip);
    }
    run = [];
    runKind = null;
  };

  for (const item of items) {
    // A dashed outline cannot come from a shader that draws the whole ring, so
    // the shape is walked and dashed. The fill still goes through the normal
    // run, with the stroke taken off it so it is not drawn solid underneath.
    const dash = dashPatternOf(item);
    // A ramp cannot come out of the distance function either, so a gradient
    // stroke takes the same walk a dash does.
    const strokeGradient = isGradient(item.stroke) && item.bounds ? (item.stroke as SceneGradient) : null;
    if (dash || strokeGradient) {
      flushRun();
      // The fill first, which is the order canvas paints them in. Drawn after
      // the dash it covers the inner half of every run.
      const filled = { ...item, stroke: undefined } as SceneSymbolExt;
      if (isGradient(item.fill)) {
        drawGradientSymbol(device, ctx, res, filled, clip);
      } else if (item.fill) {
        run.push(filled);
        runKind = runKindOf(filled);
        flushRun();
      }
      drawSymbolOutline(device, ctx, res, item, dash, strokeGradient, clip);
      continue;
    }
    // Gradient fills need the gradient pipeline and are drawn one at a time.
    if (isGradient(item.fill)) {
      flushRun();
      drawGradientSymbol(device, ctx, res, item, clip);
      continue;
    }
    const kind = runKindOf(item);
    if (kind !== runKind) {
      flushRun();
      runKind = kind;
    }
    run.push(item);
  }
  flushRun();
}

/**
 * What an item can share a draw with. Shapes with a distance function are one
 * instanced quad each, so a run can hold any mix of sizes, stroke widths and
 * angles. A triangulated shape shares its geometry, so those have to agree.
 */
function runKindOf(item: SceneSymbolExt): string {
  const shape = item.shape || 'circle';
  const core =
    shape === 'circle'
      ? 'circle'
      : hasSdf(shape)
        ? `sdf|${shape}`
        : `${shape}|${item.size ?? 64}|${item.stroke ? (item.strokeWidth ?? 1) : 0}`;
  return `${core}!${blendKey(item.blend)}`;
}

/**
 * A symbol's outline, dashed. Its shape is a path like any other, so the same
 * contour walk serves. Scale is already baked in by `size`, so only the item's
 * rotation and position apply. A line legend's swatch is a `symbol` with
 * `shape: 'stroke'` and a dash, which is where this shows.
 */
function drawSymbolOutline(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: SymbolResources,
  item: SceneSymbolExt,
  pattern: number[] | null,
  gradient: SceneGradient | null,
  clip: ReturnType<typeof markClip>,
): void {
  if (!item.stroke) {
    return;
  }
  // A dash is measured along the contour, so it takes the coarse one whatever
  // the ratio. A solid outline is only drawn on it and takes the fine one.
  const geom = symbolShapeGeometry(ctx, item.shape || 'circle', item.size ?? 64, pattern ? DASH_FLATNESS : undefined);
  const data = strokeOutline(
    geom.lines,
    pattern,
    gradient
      ? whiteCarrier(item.opacity, item.strokeOpacity)
      : Color.from2(item.stroke, item.opacity, item.strokeOpacity),
    item.strokeWidth ?? 1,
    item.strokeDashOffset ?? 0,
    item.x || 0,
    item.y || 0,
    { angle: (item.angle || 0) * DEG_TO_RAD, scaleX: 1, scaleY: 1 },
    strokeEnds(item),
  );
  if (!data) {
    return;
  }
  enqueueOutline(
    {
      ...res.outline,
      ctx,
      device,
      bufferManager: res.bufferManager,
      uniformBuffer: res.bufferManager.createUniformBuffer(),
      clip,
    },
    data,
    blendKey(item.blend),
    gradient,
    item.bounds,
  );
}

function drawShapeGroup(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: SymbolResources,
  uniformBuffer: GPUBuffer,
  key: string,
  blend: string,
  group: SceneSymbolExt[],
  clip: ReturnType<typeof markClip>,
): void {
  const first = group[0];
  // A shape with no distance function is triangulated, and this used to draw it
  // through the one pipeline whatever the item asked for, so it never blended.
  const pipeline = res.shapePipelineFor(blend);
  const bindGroup = createUniformBindGroup(`${drawName}Shape`, device, pipeline, uniformBuffer);
  const geom = getShapeGeometry(res, ctx, key, first.shape || 'circle', first.size ?? 64, first.strokeWidth ?? 1);

  if (geom.fill && geom.fillCount > 0) {
    const instances = instanceData(
      group,
      item => Color.from2(item.fill, item.opacity, item.fillOpacity),
      item => Boolean(item.fill && item.fill !== 'transparent'),
    );
    if (instances.count > 0) {
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [geom.fillCount, instances.count],
        vertexBuffers: [geom.fill, res.bufferManager.createInstanceBuffer(instances.data)],
        bindGroups: [bindGroup],
        clip,
      });
    }
  }

  if (geom.stroke && geom.strokeCount > 0) {
    const instances = instanceData(
      group,
      item => Color.from2(item.stroke, item.opacity, item.strokeOpacity),
      item => Boolean(item.stroke && item.stroke !== 'transparent'),
    );
    if (instances.count > 0) {
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [geom.strokeCount, instances.count],
        vertexBuffers: [geom.stroke, res.bufferManager.createInstanceBuffer(instances.data)],
        bindGroups: [bindGroup],
        clip,
      });
    }
  }
}

/** Draws one gradient-filled symbol: gradient fill + solid stroke, triangulated. */
function drawGradientSymbol(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: SymbolResources,
  item: SceneSymbolExt,
  clip: ReturnType<typeof markClip>,
): void {
  const bounds = item.bounds;
  if (!bounds) {
    return;
  }
  const pathGeom = symbolShapeGeometry(ctx, item.shape || 'circle', item.size ?? 64);
  const geometry = geometryForItem(ctx, item, pathGeom, false, item.x || 0, item.y || 0);
  const fill = whiteCarrier(item.opacity, item.fillOpacity);
  const stroke = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
  const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);
  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const vertexLength = res.colorVertexManager.getVertexLength();

  if (fillData.length > 0) {
    const gres = getGradientResources(device, ctx);
    const gradientPipeline = res.gradientPipelineFor(blendKey(item.blend));
    ctx._renderQueue.enqueue({
      pipeline: gradientPipeline,
      drawCounts: [fillData.length / vertexLength],
      vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
      bindGroups: [
        createUniformBindGroup(`${drawName}Gradient`, device, gradientPipeline, uniformBuffer),
        createGradientBindGroup(gres, gradientPipeline, item.fill as SceneGradient, gradientBounds(ctx, bounds)),
      ],
      clip,
    });
  }

  if (strokeData.length > 0) {
    ctx._renderQueue.enqueue({
      pipeline: res.solidPipeline,
      drawCounts: [strokeData.length / vertexLength],
      vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
      bindGroups: [createUniformBindGroup(`${drawName}Solid`, device, res.solidPipeline, uniformBuffer)],
      clip,
    });
  }
}

const DEG_TO_RAD = Math.PI / 180;

/** Builds [centerX, centerY, r, g, b, a, angle] instance rows for items passing `keep`. */
function instanceData(
  group: SceneSymbolExt[],
  color: (item: SceneSymbolExt) => readonly number[],
  keep: (item: SceneSymbolExt) => boolean,
): { data: Float32Array; count: number } {
  const rows: number[] = [];
  let count = 0;
  for (const item of group) {
    if (!keep(item)) {
      continue;
    }
    const c = color(item);
    rows.push(item.x || 0, item.y || 0, c[0], c[1], c[2], c[3], (item.angle || 0) * DEG_TO_RAD);
    count++;
  }
  return { data: Float32Array.from(rows), count };
}

function getShapeGeometry(
  res: SymbolResources,
  ctx: GPUVegaCanvasContext,
  key: string,
  shape: string,
  size: number,
  strokeWidth: number,
): ShapeGeometry {
  const cached = res.shapeCache.get(key);
  if (cached) {
    res.shapeCache.delete(key);
    res.shapeCache.set(key, cached);
    return cached;
  }
  const pathGeom = symbolShapeGeometry(ctx, shape, size);
  // Origin-centered fill + stroke triangles (dx/dy default to 0).
  const geometry = geometryForItem(ctx, { fill: '#000', stroke: '#000', strokeWidth, opacity: 1 }, pathGeom);
  // Held across frames, so these stay out of the frame pool: a pooled buffer is
  // destroyed when the frame that made it ends, and the cache then handed out a
  // destroyed one. `[Buffer "Symbol Geometry Buffer"] used in submit while
  // destroyed` on the next frame that reached this shape.
  // Held across frames, so these stay out of the frame pool. A pooled buffer is
  // destroyed two frames after the one that made it, and the cache went on
  // handing out the destroyed one: `[Buffer "Symbol Geometry Buffer"] used in
  // submit while destroyed` on every frame after the third.
  const entry: ShapeGeometry = {
    fill:
      geometry.fillCount > 0
        ? res.bufferManager.createGeometryBuffer(stripZ(geometry.fillTriangles, geometry.fillCount), undefined, true)
        : null,
    fillCount: geometry.fillCount,
    stroke:
      geometry.strokeCount > 0
        ? res.bufferManager.createGeometryBuffer(
            stripZ(geometry.strokeTriangles, geometry.strokeCount),
            undefined,
            true,
          )
        : null,
    strokeCount: geometry.strokeCount,
  };
  if (res.shapeCache.size >= MAX_SHAPE_CACHE) {
    const oldest = res.shapeCache.keys().next().value;
    if (oldest !== undefined) {
      const evicted = res.shapeCache.get(oldest);
      res.shapeCache.delete(oldest);
      if (evicted) {
        if (evicted.fill) {
          ctx._renderer?.deferDestroy(evicted.fill);
        }
        if (evicted.stroke) {
          ctx._renderer?.deferDestroy(evicted.stroke);
        }
      }
    }
  }
  res.shapeCache.set(key, entry);
  return entry;
}

/** Drops the z coordinate: [x,y,z]* -> [x,y]* for the 2D shape shader. */
function stripZ(triangles: Float32Array, count: number): Float32Array {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    out[i * 2] = triangles[i * 3];
    out[i * 2 + 1] = triangles[i * 3 + 1];
  }
  return out;
}

/** Instance data for the analytic shapes: one quad each, no triangulation. */
/** Floats per sdf instance: centre, size, fill, stroke, width, angle. */
const SDF_STRIDE = 13;

/**
 * One scratch array the instance builders write into, so a mark does not mint
 * a new one every frame. createBuffer copies through writeBuffer before it
 * returns, so the next builder is free to overwrite it. At 300k symbols this is
 * 13.7 MB a frame that no longer has to be allocated and collected.
 */
let scratch = new Float32Array(0);

function scratchFor(length: number): Float32Array {
  if (scratch.length < length) {
    scratch = new Float32Array(length);
  }
  return scratch.subarray(0, length);
}

function createSdfAttributes(items: SceneItem[]): Float32Array {
  const result = scratchFor(items.length * SDF_STRIDE);
  for (let i = 0, len = items.length; i < len; i++) {
    const item = items[i] as SceneSymbolExt;
    const { fill, stroke, strokeWidth = 1, opacity = 1, fillOpacity = 1, strokeOpacity = 1 } = item;
    const base = i * SDF_STRIDE;
    result[base] = item.x || 0;
    result[base + 1] = item.y || 0;
    result[base + 2] = Math.sqrt(item.size ?? 64);
    Color.write(result, base + 3, fill, opacity, fillOpacity);
    Color.write(result, base + 7, stroke, opacity, strokeOpacity);
    result[base + 11] = stroke ? strokeWidth : 0;
    result[base + 12] = ((item.angle || 0) * Math.PI) / 180;
  }
  return result;
}

/** Pipeline for one analytic shape, compiled on first use. */
function sdfPipeline(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: SymbolResources,
  shape: string,
  blend = 'normal',
): GPURenderPipeline {
  const cacheKey = `${shape}!${blend}`;
  let pipeline = res.sdfPipelines.get(cacheKey);
  if (!pipeline) {
    pipeline = markPipeline(
      ctx,
      device,
      `${drawName}Sdf ${shape}`,
      symbolSdfKey(shape),
      res.sdfVertexManager,
      undefined,
      blend,
    );
    res.sdfPipelines.set(cacheKey, pipeline);
  }
  return pipeline;
}

/** Floats per circle instance: centre, radius, fill, stroke, width. */
const CIRCLE_STRIDE = 12;

function createCircleAttributes(items: SceneItem[]): Float32Array {
  const result = scratchFor(items.length * CIRCLE_STRIDE);
  for (let i = 0, len = items.length; i < len; i++) {
    const item = items[i] as SceneSymbolExt;
    const { fill, stroke, strokeWidth = 1, opacity = 1, fillOpacity = 1, strokeOpacity = 1 } = item;
    const base = i * CIRCLE_STRIDE;
    result[base] = item.x || 0;
    result[base + 1] = item.y || 0;
    result[base + 2] = Math.sqrt(item.size ?? 64) / 2;
    Color.write(result, base + 3, fill, opacity, fillOpacity);
    Color.write(result, base + 7, stroke, opacity, strokeOpacity);
    result[base + 11] = stroke ? strokeWidth : 0;
  }
  return result;
}

function createCircleGeometry(): Float32Array {
  return new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
}

export default {
  type: 'symbol',
  draw,
} satisfies MarkModule;
