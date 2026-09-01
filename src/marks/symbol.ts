import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneGradient, SceneItem, SceneSymbolExt } from '../types/scene.js';
import geometryForItem from '../path/geometryForItem.js';
import { symbol as symbolShapeGeometry } from '../path/shapes.js';
import { BufferManager } from '../util/bufferManager.js';
import { Color, isGradient } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  geometryVertexData,
  getMarkResources,
  gradientBounds,
  markClip,
  markPipeline,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const segments = 32;
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
  shapeCache: Map<string, ShapeGeometry>;
  // Per-vertex-colored triangles for gradient-filled symbols (rare, e.g. a
  // legend swatch): one non-instanced draw per item.
  colorVertexManager: VertexBufferManager;
  solidPipeline: GPURenderPipeline;
  gradientPipeline: GPURenderPipeline;
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
    const circleGeometry = bufferManager.createGeometryBuffer(createCircleGeometry());
    const colorVertexManager = new VertexBufferManager(['float32x3', 'float32x4']); // position, color
    const solidPipeline = markPipeline(ctx, device, `${drawName}Solid`, 'Shape', colorVertexManager);
    const gradientPipeline = markPipeline(ctx, device, `${drawName}Gradient`, 'GradientFill', colorVertexManager);
    return {
      device,
      bufferManager,
      circleVertexManager,
      circlePipeline,
      circleGeometry,
      shapePipeline,
      shapeCache: new Map(),
      colorVertexManager,
      solidPipeline,
      gradientPipeline,
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
  let circleBindGroup: GPUBindGroup | null = null;
  let shapeBindGroup: GPUBindGroup | null = null;

  const flushRun = () => {
    if (run.length === 0 || runKind === null) {
      return;
    }
    if (runKind === 'circle') {
      circleBindGroup ??= createUniformBindGroup(drawName, device, res.circlePipeline, uniformBuffer);
      const instanceBuffer = res.bufferManager.createInstanceBuffer(createCircleAttributes(run));
      ctx._renderQueue.enqueue({
        pipeline: res.circlePipeline,
        drawCounts: [segments * 3, run.length],
        vertexBuffers: [res.circleGeometry, instanceBuffer],
        bindGroups: [circleBindGroup],
        clip,
      });
    } else {
      shapeBindGroup ??= createUniformBindGroup(`${drawName}Shape`, device, res.shapePipeline, uniformBuffer);
      drawShapeGroup(device, ctx, res, shapeBindGroup, runKind, run, clip);
    }
    run = [];
    runKind = null;
  };

  for (const item of items) {
    // Gradient fills need the gradient pipeline and are drawn one at a time.
    if (isGradient(item.fill)) {
      flushRun();
      drawGradientSymbol(device, ctx, res, item, clip);
      continue;
    }
    const shape = item.shape || 'circle';
    const kind =
      shape === 'circle' ? 'circle' : `${shape}|${item.size ?? 64}|${item.stroke ? (item.strokeWidth ?? 1) : 0}`;
    if (kind !== runKind) {
      flushRun();
      runKind = kind;
    }
    run.push(item);
  }
  flushRun();
}

function drawShapeGroup(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: SymbolResources,
  bindGroup: GPUBindGroup,
  key: string,
  group: SceneSymbolExt[],
  clip: ReturnType<typeof markClip>,
): void {
  const first = group[0];
  const geom = getShapeGeometry(res, ctx, key, first.shape || 'circle', first.size ?? 64, first.strokeWidth ?? 1);

  if (geom.fill && geom.fillCount > 0) {
    const instances = instanceData(
      group,
      item => Color.from2(item.fill, item.opacity, item.fillOpacity),
      item => Boolean(item.fill && item.fill !== 'transparent'),
    );
    if (instances.count > 0) {
      ctx._renderQueue.enqueue({
        pipeline: res.shapePipeline,
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
        pipeline: res.shapePipeline,
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
    ctx._renderQueue.enqueue({
      pipeline: res.gradientPipeline,
      drawCounts: [fillData.length / vertexLength],
      vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
      bindGroups: [
        createUniformBindGroup(`${drawName}Gradient`, device, res.gradientPipeline, uniformBuffer),
        createGradientBindGroup(gres, res.gradientPipeline, item.fill as SceneGradient, gradientBounds(ctx, bounds)),
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
    rows.push(item.x ?? 0, item.y ?? 0, c[0], c[1], c[2], c[3], (item.angle ?? 0) * DEG_TO_RAD);
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
  const entry: ShapeGeometry = {
    fill:
      geometry.fillCount > 0
        ? res.bufferManager.createGeometryBuffer(stripZ(geometry.fillTriangles, geometry.fillCount))
        : null,
    fillCount: geometry.fillCount,
    stroke:
      geometry.strokeCount > 0
        ? res.bufferManager.createGeometryBuffer(stripZ(geometry.strokeTriangles, geometry.strokeCount))
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

function createCircleAttributes(items: SceneItem[]): Float32Array {
  const result = new Float32Array(items.length * 12);
  let index = -1;
  for (let i = 0, len = items.length; i < len; i++) {
    const {
      x = 0,
      y = 0,
      size = 64,
      fill,
      stroke,
      strokeWidth = 1,
      opacity = 1,
      fillOpacity = 1,
      strokeOpacity = 1,
    } = items[i] as SceneSymbolExt;
    const col = Color.from2(fill, opacity, fillOpacity);
    const scol = Color.from2(stroke, opacity, strokeOpacity);
    const rad = Math.sqrt(size) / 2;

    result[++index] = x;
    result[++index] = y;
    result[++index] = rad;
    result[++index] = col[0];
    result[++index] = col[1];
    result[++index] = col[2];
    result[++index] = col[3];
    result[++index] = scol[0];
    result[++index] = scol[1];
    result[++index] = scol[2];
    result[++index] = scol[3];
    result[++index] = stroke ? strokeWidth : 0;
  }
  return result;
}

function createCircleGeometry(): Float32Array {
  return new Float32Array(
    Array.from({ length: segments }, (_, i) => {
      const j = (i + 1) % segments;
      const ang1 = !i ? 0 : ((Math.PI * 2.0) / segments) * i;
      const ang2 = !j ? 0 : ((Math.PI * 2.0) / segments) * j;
      const x1 = Math.cos(ang1);
      const y1 = Math.sin(ang1);
      const x2 = Math.cos(ang2);
      const y2 = Math.sin(ang2);
      return [x1, y1, 0, 0, x2, y2];
    }).flat(),
  );
}

export default {
  type: 'symbol',
  draw,
} satisfies MarkModule;
