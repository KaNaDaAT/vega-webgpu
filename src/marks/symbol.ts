import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneGradient, SceneItem, SceneSymbolExt } from '../types/scene.js';
import geometryForItem from '../path/geometryForItem.js';
import { symbol as symbolShapeGeometry } from '../path/shapes.js';
import { DASH_FLATNESS } from '../path/geometryForPath.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey, needsBackdrop } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { hasSdf } from '../shaders/symbolSdf.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  clipMaskView,
  outlinePipelines,
  type OutlinePipelines,
  dashPatternOf,
  enqueueGradient,
  enqueueOutline,
  enqueueSolid,
  gradientTargetOf,
  outlineTargetOf,
  solidTargetOf,
  strokeOutline,
  geometryVertexData,
  getMarkResources,
  instanceScratch,
  markClip,
  markItems,
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
  circlePipelineFor: (blend: string) => GPURenderPipeline;
  // Triangulated shapes, instanced per (shape, size).
  shapePipelineFor: (blend: string) => GPURenderPipeline;
  shapeCache: Map<string, ShapeGeometry>;
  /** Pipelines for an outline drawn through the segment shader. */
  outline: OutlinePipelines;
  sdfVertexManager: VertexBufferManager;
  quadGeometry: GPUBuffer;
  // Per-vertex-colored triangles for gradient-filled symbols (rare, e.g. a
  // legend swatch): one non-instanced draw per item.
  colorVertexManager: VertexBufferManager;
  solidPipelineFor: (blend: string) => GPURenderPipeline;
  gradientPipelineFor: (blend: string) => GPURenderPipeline;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): SymbolResources {
  return getMarkResources(ctx, 'symbol', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName);
    const circleVertexManager = new VertexBufferManager(
      ['float32x2'], // position
      // center, radius, fill color, stroke color, stroke width
      ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32'],
    );
    const circlePipelineFor = blendPipelines(ctx, device, drawName, drawName, circleVertexManager);
    const shapeVertexManager = new VertexBufferManager(
      ['float32x2'], // geometry position (centered on origin)
      ['float32x2', 'float32x4', 'float32'], // instance center, color, angle
    );
    const shapePipelineFor = blendPipelines(ctx, device, `${drawName}Shape`, 'SymbolShape', shapeVertexManager);
    const sdfVertexManager = new VertexBufferManager(
      ['float32x2'], // unit quad position
      // center, size, fill color, stroke color, stroke width, angle
      ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32', 'float32'],
    );
    // One square for both the circle and the sdf quads: nothing culls, so the
    // winding the two used to differ by was never observable.
    const quadGeometry = bufferManager.createGeometryBuffer(
      Float32Array.from([-1, -1, -1, 1, 1, -1, 1, -1, -1, 1, 1, 1]),
      true,
    );
    const colorVertexManager = new VertexBufferManager(['float32x3', 'float32x4']); // position, color
    const solidPipelineFor = blendPipelines(ctx, device, `${drawName}Solid`, 'SolidFill', colorVertexManager);
    // a dashed outline draws as segments, the way a dashed line and a dashed
    // group border already do
    const outline = outlinePipelines(ctx, device, `${drawName}Dash`);
    // a gradient fill under a blend needs its own pipeline too
    const gradientPipelineFor = blendPipelines(ctx, device, `${drawName}Gradient`, 'GradientFill', colorVertexManager);
    return {
      device,
      bufferManager,
      circlePipelineFor,
      shapePipelineFor,
      shapeCache: new Map(),
      outline,
      sdfVertexManager,
      quadGeometry,
      colorVertexManager,
      solidPipelineFor,
      gradientPipelineFor,
    };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = markItems<SceneSymbolExt>(scene);
  if (items.length === 0) {
    return;
  }

  const res = getResources(device, ctx, vb);
  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const clip = markClip(ctx, scene);

  let run: SceneSymbolExt[] = [];
  let circleBindGroup: { group: GPUBindGroup; pipeline: GPURenderPipeline } | null = null;

  const flushRun = () => {
    if (run.length === 0) {
      return;
    }
    const first = run[0];
    const shape = first.shape || 'circle';
    const runBlend = blendKey(first.blend);
    if (shape === 'circle') {
      const circlePipeline = res.circlePipelineFor(runBlend);
      // A bind group belongs to the layout it was made from, so a mark whose
      // items carry different blends cannot hold one across the change.
      if (circleBindGroup === null || circleBindGroup.pipeline !== circlePipeline) {
        circleBindGroup = {
          group: createUniformBindGroup(drawName, device, circlePipeline, uniformBuffer, clipMaskView(ctx, device)),
          pipeline: circlePipeline,
        };
      }
      const instanceBuffer = res.bufferManager.createInstanceBuffer(createCircleAttributes(run));
      ctx._renderQueue.enqueue({
        pipeline: circlePipeline,
        drawCounts: [6, run.length],
        vertexBuffers: [res.quadGeometry, instanceBuffer],
        bindGroups: [circleBindGroup.group],
        clip,
      });
    } else if (hasSdf(shape)) {
      const pipeline = markPipeline(
        ctx,
        device,
        `${drawName}Sdf ${shape}`,
        `SymbolSdf:${shape}`,
        res.sdfVertexManager,
        undefined,
        runBlend,
      );
      const instanceBuffer = res.bufferManager.createInstanceBuffer(createSdfAttributes(run));
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [6, run.length],
        vertexBuffers: [res.quadGeometry, instanceBuffer],
        bindGroups: [
          createUniformBindGroup(`${drawName}Sdf`, device, pipeline, uniformBuffer, clipMaskView(ctx, device)),
        ],
        clip,
      });
    } else {
      drawShapeGroup(device, ctx, res, uniformBuffer, runBlend, run, clip);
    }
    run = [];
  };

  for (const item of items) {
    // A dashed outline cannot come from a shader that draws the whole ring, so
    // the shape is walked and dashed. The fill still goes through the normal
    // run, with the stroke taken off it so it is not drawn solid underneath.
    const dash = dashPatternOf(item);
    // A ramp cannot come out of the distance function either, so a gradient
    // stroke takes the same walk a dash does.
    const strokeGradient = isGradient(item.stroke) && item.bounds ? item.stroke : null;
    if (dash || strokeGradient) {
      flushRun();
      // The fill first, which is the order canvas paints them in. Drawn after
      // the dash it covers the inner half of every run.
      const filled = { ...item, stroke: undefined } as SceneSymbolExt;
      if (isGradient(item.fill)) {
        drawGradientSymbol(device, ctx, res, filled, clip);
      } else if (item.fill) {
        run.push(filled);
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
    if (run.length > 0 && !sharesRun(run[0], item)) {
      flushRun();
    }
    run.push(item);
    // One draw per item, see needsBackdrop.
    if (needsBackdrop(blendKey(item.blend), ctx._opaqueBackdrop)) {
      flushRun();
    }
  }
  flushRun();
}

/**
 * Whether two items can share a draw. A circle and a shape with a distance
 * function are one instanced quad each, so a run can hold any mix of sizes,
 * stroke widths and angles. A triangulated shape shares its geometry buffer,
 * so those have to agree as well.
 */
function sharesRun(a: SceneSymbolExt, b: SceneSymbolExt): boolean {
  const shape = a.shape || 'circle';
  if (shape !== (b.shape || 'circle') || blendKey(a.blend) !== blendKey(b.blend)) {
    return false;
  }
  if (shape === 'circle' || hasSdf(shape)) {
    return true;
  }
  return (a.size ?? 64) === (b.size ?? 64) && strokeWidthOf(a) === strokeWidthOf(b);
}

/** The width a triangulated symbol's shared geometry is built at. */
function strokeWidthOf(item: SceneSymbolExt): number {
  return item.stroke ? (item.strokeWidth ?? 1) : 0;
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
      : Color.from(item.stroke, item.opacity, item.strokeOpacity),
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
    outlineTargetOf(ctx, device, res, res.bufferManager.sharedUniformBuffer(), clip),
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
  blend: string,
  group: SceneSymbolExt[],
  clip: ReturnType<typeof markClip>,
): void {
  const first = group[0];
  const key = `${first.shape || 'circle'}|${first.size ?? 64}|${strokeWidthOf(first)}`;
  // A shape with no distance function is triangulated, and this used to draw it
  // through the one pipeline whatever the item asked for, so it never blended.
  const pipeline = res.shapePipelineFor(blend);
  const bindGroup = createUniformBindGroup(
    `${drawName}Shape`,
    device,
    pipeline,
    uniformBuffer,
    clipMaskView(ctx, device),
  );
  const geom = getShapeGeometry(res, ctx, key, first.shape || 'circle', first.size ?? 64, first.strokeWidth ?? 1);

  if (geom.fill && geom.fillCount > 0) {
    const instances = instanceData(group, false);
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
    const instances = instanceData(group, true);
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
  const geometry = geometryForItem(ctx, item, pathGeom, false, item.x || 0, item.y || 0, {
    angle: (item.angle || 0) * DEG_TO_RAD,
    scaleX: 1,
    scaleY: 1,
  });
  const fill = whiteCarrier(item.opacity, item.fillOpacity);
  const stroke = Color.from(item.stroke, item.opacity, item.strokeOpacity);
  const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);
  const uniformBuffer = res.bufferManager.sharedUniformBuffer();
  const fills = {
    pipelineFor: res.solidPipelineFor,
    gradientPipelineFor: res.gradientPipelineFor,
    bufferManager: res.bufferManager,
  };
  const blend = blendKey(item.blend);

  if (fillData.length > 0) {
    const target = gradientTargetOf(ctx, device, `${drawName}Gradient`, fills, uniformBuffer, clip);
    enqueueGradient(target, fillData, item.fill as SceneGradient, bounds, blend);
  }

  if (strokeData.length > 0) {
    const target = solidTargetOf(ctx, device, `${drawName}Solid`, fills, uniformBuffer, clip);
    enqueueSolid(target, strokeData, blend);
  }
}

const DEG_TO_RAD = Math.PI / 180;

/** Floats per triangulated shape instance: centre, colour, angle. */
const SHAPE_STRIDE = 7;

/** Instance rows for the items of a run that carry the paint being drawn. */
function instanceData(group: SceneSymbolExt[], stroke: boolean): { data: Float32Array; count: number } {
  const out = instanceScratch(group.length * SHAPE_STRIDE);
  let count = 0;
  for (const item of group) {
    const paint = stroke ? item.stroke : item.fill;
    if (!paint || paint === 'transparent') {
      continue;
    }
    const base = count * SHAPE_STRIDE;
    out[base] = item.x || 0;
    out[base + 1] = item.y || 0;
    Color.write(out, base + 2, paint, item.opacity, stroke ? item.strokeOpacity : item.fillOpacity);
    out[base + 6] = (item.angle || 0) * DEG_TO_RAD;
    count++;
  }
  return { data: out.subarray(0, count * SHAPE_STRIDE), count };
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
  // Held across frames, so these stay out of the frame pool. A pooled buffer is
  // destroyed two frames after the one that made it, and the cache went on
  // handing out the destroyed one: `[Buffer "Symbol Geometry Buffer"] used in
  // submit while destroyed` on every frame after the third.
  const entry: ShapeGeometry = {
    fill:
      geometry.fillCount > 0
        ? res.bufferManager.createGeometryBuffer(stripZ(geometry.fillTriangles, geometry.fillCount), true)
        : null,
    fillCount: geometry.fillCount,
    stroke:
      geometry.strokeCount > 0
        ? res.bufferManager.createGeometryBuffer(stripZ(geometry.strokeTriangles, geometry.strokeCount), true)
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
          ctx._renderer.deferDestroy(evicted.fill);
        }
        if (evicted.stroke) {
          ctx._renderer.deferDestroy(evicted.stroke);
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

/** Floats per sdf instance: centre, size, fill, stroke, width, angle. */
const SDF_STRIDE = 13;

/** Instance data for the analytic shapes: one quad each, no triangulation. */
function createSdfAttributes(items: SceneItem[]): Float32Array {
  const result = instanceScratch(items.length * SDF_STRIDE);
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

/** Floats per circle instance: centre, radius, fill, stroke, width. */
const CIRCLE_STRIDE = 12;

function createCircleAttributes(items: SceneItem[]): Float32Array {
  const result = instanceScratch(items.length * CIRCLE_STRIDE);
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

export default { draw } satisfies MarkModule;
