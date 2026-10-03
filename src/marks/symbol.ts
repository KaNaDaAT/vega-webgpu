import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneSymbolExt } from '../types/scene.js';
import geometryForItem, { itemTurn } from '../path/geometryForItem.js';
import { symbol as symbolShapeGeometry } from '../path/shapes.js';
import { DASH_FLATNESS } from '../path/geometryForPath.js';
import { BufferManager, bufferPool } from '../util/bufferManager.js';
import { LruMap } from '../util/lru.js';
import { blendKey } from '../util/blend.js';
import { Color } from '../util/color.js';
import { hasSdf } from '../shaders/symbolSdf.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import {
  outlinePipelines,
  type OutlinePipelines,
  dashPatternOf,
  enqueueOutline,
  segmentInstances,
  strokeRuns,
  vertexData,
  getMarkResources,
  instanceScratch,
  markItems,
  blendPipelines,
  markPipeline,
  strokeEnds,
  type MarkModule,
  uniformBindGroup,
  enqueueFill,
  paintColour,
  rampOf,
  targetOf,
  type DrawTarget,
  type Ramp,
} from './util.js';
import { DrawRun } from '../util/drawRun.js';

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
  shapeCache: LruMap<string, ShapeGeometry>;
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
      // a draw queued this frame may still read an evicted one, so the pool frees it later
      shapeCache: new LruMap<string, ShapeGeometry>(MAX_SHAPE_CACHE, ({ fill, stroke }) => {
        if (fill) {
          bufferPool(device).hold(fill);
        }
        if (stroke) {
          bufferPool(device).hold(stroke);
        }
      }),
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

  let circleBindGroup: { group: GPUBindGroup; pipeline: GPURenderPipeline } | null = null;
  // Built for the first dashed or gradient symbol, and kept for the rest.
  let outline: DrawTarget | null = null;
  let gradient: DrawTarget | null = null;
  const outlineTarget = () =>
    (outline ??= targetOf(
      ctx,
      device,
      res.outline.name,
      res.outline,
      res.bufferManager,
      res.bufferManager.sharedUniformBuffer(),
    ));
  const gradientTarget = () =>
    (gradient ??= targetOf(
      ctx,
      device,
      `${drawName}Fill`,
      { pipelineFor: res.solidPipelineFor, gradientPipelineFor: res.gradientPipelineFor },
      res.bufferManager,
      res.bufferManager.sharedUniformBuffer(),
    ));

  const run = new DrawRun<SceneSymbolExt>(ctx._opaqueBackdrop, (symbols, runBlend) => {
    const shape = symbolShape(symbols[0]);
    if (shape === 'circle') {
      const circlePipeline = res.circlePipelineFor(runBlend);
      // A bind group belongs to the layout it was made from, so a mark whose
      // items carry different blends cannot hold one across the change.
      if (circleBindGroup === null || circleBindGroup.pipeline !== circlePipeline) {
        circleBindGroup = {
          group: uniformBindGroup(ctx, device, drawName, circlePipeline, uniformBuffer),
          pipeline: circlePipeline,
        };
      }
      const instanceBuffer = res.bufferManager.createInstanceBuffer(quadInstances(symbols, true));
      ctx._renderQueue.enqueue({
        pipeline: circlePipeline,
        drawCounts: [6, symbols.length],
        vertexBuffers: [res.quadGeometry, instanceBuffer],
        bindGroups: [circleBindGroup.group],
        clip: ctx._clip,
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
      const instanceBuffer = res.bufferManager.createInstanceBuffer(quadInstances(symbols, false));
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [6, symbols.length],
        vertexBuffers: [res.quadGeometry, instanceBuffer],
        bindGroups: [uniformBindGroup(ctx, device, `${drawName}Sdf`, pipeline, uniformBuffer)],
        clip: ctx._clip,
      });
    } else {
      drawShapeGroup(device, ctx, res, uniformBuffer, runBlend, symbols);
    }
  });

  for (const item of items) {
    const blend = blendKey(item.blend);
    // A dashed outline cannot come from a shader that draws the whole ring, so
    // the shape is walked and dashed. The fill still goes through the normal
    // run, with the stroke taken off it so it is not drawn solid underneath.
    const dash = dashPatternOf(item);
    // A ramp cannot come out of the distance function either, so a gradient
    // stroke takes the same walk a dash does.
    const strokeRamp = rampOf(item.stroke, item.bounds);
    const fillRamp = rampOf(item.fill, item.bounds);
    if (dash || strokeRamp) {
      run.flush();
      // The fill first, which is the order canvas paints them in. Drawn after
      // the dash it covers the inner half of every run.
      const filled = { ...item, stroke: undefined } as SceneSymbolExt;
      if (fillRamp) {
        drawGradientSymbol(ctx, gradientTarget(), filled, fillRamp, blend);
      } else if (item.fill) {
        run.add(filled, blend, runKey(filled));
        run.flush();
      }
      drawSymbolOutline(ctx, outlineTarget(), item, blend, dash, strokeRamp);
      continue;
    }
    // Gradient fills need the gradient pipeline and are drawn one at a time.
    if (fillRamp) {
      run.flush();
      drawGradientSymbol(ctx, gradientTarget(), item, fillRamp, blend);
      continue;
    }
    run.add(item, blend, runKey(item));
  }
  run.flush();
}

/** vega's defaults, which a symbol that sets neither is drawn with. */
const symbolShape = (item: SceneSymbolExt): string => item.shape || 'circle';
const symbolSize = (item: SceneSymbolExt): number => item.size ?? 64;

/**
 * What a symbol shares a draw on, beside its blend. A circle and a shape with a
 * distance function are one instanced quad each, so a run can hold any mix of
 * sizes, stroke widths and angles. A triangulated shape shares its geometry
 * buffer, so those have to agree as well.
 */
function runKey(item: SceneSymbolExt): string {
  const shape = symbolShape(item);
  return shape === 'circle' || hasSdf(shape) ? shape : `${shape}|${symbolSize(item)}|${strokeWidthOf(item)}`;
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
  ctx: GPUVegaCanvasContext,
  target: DrawTarget,
  item: SceneSymbolExt,
  blend: string,
  pattern: number[] | null,
  ramp: Ramp | null,
): void {
  if (!item.stroke) {
    return;
  }
  // A dash is measured along the contour, so it takes the coarse one whatever
  // the ratio. A solid outline is only drawn on it and takes the fine one.
  const geom = symbolShapeGeometry(ctx, symbolShape(item), symbolSize(item), pattern ? DASH_FLATNESS : undefined);
  const data = segmentInstances(
    strokeRuns(geom.lines, item, { dx: item.x || 0, dy: item.y || 0, angle: itemTurn(item) }),
    paintColour(item.stroke, item.opacity, item.strokeOpacity, ramp),
    item.strokeWidth ?? 1,
    strokeEnds(item),
  );
  if (!data) {
    return;
  }
  enqueueOutline(target, data, ramp, blend);
}

function drawShapeGroup(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: SymbolResources,
  uniformBuffer: GPUBuffer,
  blend: string,
  group: SceneSymbolExt[],
): void {
  const first = group[0];
  const shape = symbolShape(first);
  const size = symbolSize(first);
  const key = `${shape}|${size}|${strokeWidthOf(first)}`;
  // A shape with no distance function is triangulated, and this used to draw it
  // through the one pipeline whatever the item asked for, so it never blended.
  const pipeline = res.shapePipelineFor(blend);
  const bindGroup = uniformBindGroup(ctx, device, `${drawName}Shape`, pipeline, uniformBuffer);
  const geom = getShapeGeometry(res, ctx, key, shape, size, first.strokeWidth ?? 1);

  if (geom.fill && geom.fillCount > 0) {
    const instances = instanceData(group, false);
    if (instances.count > 0) {
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [geom.fillCount, instances.count],
        vertexBuffers: [geom.fill, res.bufferManager.createInstanceBuffer(instances.data)],
        bindGroups: [bindGroup],
        clip: ctx._clip,
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
        clip: ctx._clip,
      });
    }
  }
}

/** Draws one gradient-filled symbol: gradient fill + solid stroke, triangulated. */
function drawGradientSymbol(
  ctx: GPUVegaCanvasContext,
  target: DrawTarget,
  item: SceneSymbolExt,
  ramp: Ramp,
  blend: string,
): void {
  const pathGeom = symbolShapeGeometry(ctx, symbolShape(item), symbolSize(item));
  const geometry = geometryForItem(ctx, item, pathGeom, false, item.x || 0, item.y || 0, {
    angle: itemTurn(item),
    scaleX: 1,
    scaleY: 1,
  });
  const fillData = vertexData(
    geometry.fillTriangles,
    geometry.fillCount,
    paintColour(item.fill, item.opacity, item.fillOpacity, ramp),
  );
  const strokeData = vertexData(
    geometry.strokeTriangles,
    geometry.strokeCount,
    Color.from(item.stroke, item.opacity, item.strokeOpacity),
  );
  if (fillData.length > 0) {
    enqueueFill(target, fillData, ramp, blend);
  }
  if (strokeData.length > 0) {
    enqueueFill(target, strokeData, null, blend);
  }
}

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
    out[base + 6] = itemTurn(item);
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

/** Floats per circle instance: centre, radius, fill, stroke, width. */
const CIRCLE_STRIDE = 12;
/** Floats per sdf instance: centre, side, fill, stroke, width, angle. */
const SDF_STRIDE = 13;

/**
 * Instance rows for the symbols drawn as one quad each: a circle, sized by its
 * radius, or a shape with a distance function, sized by its side and turned.
 */
function quadInstances(items: SceneSymbolExt[], circle: boolean): Float32Array {
  const stride = circle ? CIRCLE_STRIDE : SDF_STRIDE;
  const result = instanceScratch(items.length * stride);
  for (let i = 0, len = items.length; i < len; i++) {
    const item = items[i];
    const { fill, stroke, strokeWidth = 1, opacity = 1, fillOpacity = 1, strokeOpacity = 1 } = item;
    const base = i * stride;
    const side = Math.sqrt(symbolSize(item));
    result[base] = item.x || 0;
    result[base + 1] = item.y || 0;
    result[base + 2] = circle ? side / 2 : side;
    Color.write(result, base + 3, fill, opacity, fillOpacity);
    Color.write(result, base + 7, stroke, opacity, strokeOpacity);
    result[base + 11] = stroke ? strokeWidth : 0;
    if (!circle) {
      result[base + 12] = itemTurn(item);
    }
  }
  return result;
}

export default { draw } satisfies MarkModule;
