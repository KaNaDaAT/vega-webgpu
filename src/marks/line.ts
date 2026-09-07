import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneLinePoint } from '../types/scene.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import { dashPolyline, type Point } from '../util/dash.js';
import geometryForItem from '../path/geometryForItem.js';
import { line as lineGeometry } from '../path/shapes.js';
import {
  SEGMENT_LAYOUT,
  SEGMENT_STRIDE,
  geometryVertexData,
  getMarkResources,
  markClip,
  markPipeline,
  segmentInstances,
  type MarkModule,
} from './util.js';

const drawName = 'Line';
// Round joins are drawn as filled circles at interior vertices.
const JOIN_SEGMENTS = 24;

interface LineResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  /** Per-instance resolution/offset; batches across marks with different offsets. */
  batchVertexManager: VertexBufferManager;
  /** Resolution/offset from the uniform buffer; one instanced draw per mark. */
  instancedVertexManager: VertexBufferManager;
  batchPipeline: GPURenderPipeline;
  instancedPipeline: GPURenderPipeline;
  /** Round-join pipeline (reuses the antialiased symbol-circle shader). */
  joinPipeline: GPURenderPipeline;
  joinVertexManager: VertexBufferManager;
  joinGeometryBuffer: GPUBuffer;
  curveVertexManager: VertexBufferManager;
  curvePipeline: GPURenderPipeline;
  basisPipeline: GPURenderPipeline;
  basisVertexManager: VertexBufferManager;
  basisBindGroup: GPUBindGroup | null;
  basisBindGroupBuffer: GPUBuffer | null;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): LineResources {
  return getMarkResources(ctx, 'line', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const batchVertexManager = new VertexBufferManager(
      [],
      ['float32x2', 'float32x2', 'float32x4', 'float32', 'float32x2', 'float32x2'], // start, end, color, width, res, offset
    );
    const instancedVertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
    const batchPipeline = markPipeline(ctx, device, drawName, 'Line', batchVertexManager);
    const instancedPipeline = markPipeline(ctx, device, `S${drawName}`, 'SLine', instancedVertexManager);
    const joinVertexManager = new VertexBufferManager(
      ['float32x2'], // position (unit circle)
      // center, radius, fill color, stroke color, stroke width (symbol layout)
      ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32'],
    );
    const joinPipeline = markPipeline(ctx, device, `${drawName}Join`, 'Symbol', joinVertexManager);
    const joinGeometryBuffer = bufferManager.createGeometryBuffer(createJoinGeometry());
    const curveVertexManager = new VertexBufferManager(['float32x3', 'float32x4']); // position, color
    const basisVertexManager = new VertexBufferManager(
      [],
      // p0, p1, p2, p3, color, stroke width, kind
      ['float32x2', 'float32x2', 'float32x2', 'float32x2', 'float32x4', 'float32', 'float32'],
    );
    const basisPipeline = markPipeline(ctx, device, `${drawName}Basis`, 'Curve', basisVertexManager);
    const curvePipeline = markPipeline(ctx, device, `${drawName}Curve`, 'Path', curveVertexManager);
    return {
      curveVertexManager,
      curvePipeline,
      basisPipeline,
      basisVertexManager,
      basisBindGroup: null,
      basisBindGroupBuffer: null,
      device,
      bufferManager,
      batchVertexManager,
      instancedVertexManager,
      batchPipeline,
      instancedPipeline,
      joinPipeline,
      joinVertexManager,
      joinGeometryBuffer,
    };
  });
}

/**
 * True when the mark cannot be drawn as a plain polyline, either because it
 * uses a curve interpolation or because `defined: false` puts gaps in it.
 */
function needsPath(points: SceneLinePoint[]): boolean {
  const interp = points[0]?.interpolate;
  if (interp && interp !== 'linear') {
    return true;
  }
  return points.some(p => p.defined === false);
}

function dashPattern(item: SceneLinePoint): number[] | undefined {
  const dash = item.strokeDash;
  return Array.isArray(dash) && dash.length > 0 ? dash : undefined;
}

/**
 * Dashed lines are split into their drawn runs on the cpu and emitted as plain
 * segments. Curved lines are flattened through the path tessellation first, so
 * the same code covers both.
 */
function drawDashed(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: LineResources,
  points: SceneLinePoint[],
  pattern: number[],
  clip: ReturnType<typeof markClip>,
): void {
  const first = points[0];
  const offset = first.strokeDashOffset ?? 0;

  let polylines: Point[][];
  if (needsPath(points)) {
    polylines = lineGeometry(ctx, points).lines.map(line => line.map(p => [p[0], p[1]] as Point));
  } else {
    polylines = [points.map(p => [p.x ?? 0, p.y ?? 0] as Point)];
  }

  const runs = polylines.flatMap(line => dashPolyline(line, pattern, offset));

  const col = Color.from2(first.stroke, first.opacity, first.strokeOpacity);
  const data = segmentInstances(runs, col, first.strokeWidth ?? 1);
  if (!data) {
    return;
  }

  ctx._renderQueue.enqueue({
    pipeline: res.instancedPipeline,
    drawCounts: [6, data.length / SEGMENT_STRIDE],
    vertexBuffers: [res.bufferManager.createInstanceBuffer(data)],
    bindGroups: [
      createUniformBindGroup(`S${drawName}`, device, res.instancedPipeline, res.bufferManager.sharedUniformBuffer()),
    ],
    clip,
  });
}

const BASIS_SUBDIVISIONS = 8;

/**
 * True when the whole line can go through the GPU basis shader: an unbroken
 * basis or bundle curve. Anything else keeps the tessellated path.
 */
function isBasisCurve(points: SceneLinePoint[]): boolean {
  const interpolate = points[0]?.interpolate;
  if (interpolate !== 'basis' && interpolate !== 'bundle') {
    return false;
  }
  return points.length >= 3 && points.every(p => p.defined !== false);
}

/**
 * Instance data for one curve: a span per B-spline segment plus the two
 * straight runs d3's basis opens and closes with. Control points are doubled
 * at each end, which is what puts the first span's start at (5*P0 + P1) / 6.
 *
 * `bundle` blends every point toward the straight chord by its tension first,
 * exactly as d3 does before running basis.
 */
function basisInstances(points: SceneLinePoint[], out: number[]): void {
  const first = points[0];
  const n = points.length;
  const beta = first.interpolate === 'bundle' ? (first.tension ?? 0.85) : 1;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const x0 = points[0].x ?? 0;
  const y0 = points[0].y ?? 0;
  const dx = (points[n - 1].x ?? 0) - x0;
  const dy = (points[n - 1].y ?? 0) - y0;
  for (let i = 0; i < n; i++) {
    const px = points[i].x ?? 0;
    const py = points[i].y ?? 0;
    if (beta === 1) {
      xs[i] = px;
      ys[i] = py;
    } else {
      const t = i / (n - 1);
      xs[i] = beta * px + (1 - beta) * (x0 + t * dx);
      ys[i] = beta * py + (1 - beta) * (y0 + t * dy);
    }
  }

  const col = Color.from2(first.stroke, first.opacity, first.strokeOpacity);
  const width = first.strokeWidth ?? 1;
  // controls, doubled at both ends
  const cx = [xs[0], ...xs, xs[n - 1]];
  const cy = [ys[0], ...ys, ys[n - 1]];

  const push = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    ccx: number,
    ccy: number,
    ddx: number,
    ddy: number,
    kind: number,
  ) => {
    out.push(ax, ay, bx, by, ccx, ccy, ddx, ddy, col[0], col[1], col[2], col[3], width, kind);
  };
  const basis = (i: number, t: number, axis: number[]): number => {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      ((1 - 3 * t + 3 * t2 - t3) * axis[i] +
        (4 - 6 * t2 + 3 * t3) * axis[i + 1] +
        (1 + 3 * t + 3 * t2 - 3 * t3) * axis[i + 2] +
        t3 * axis[i + 3]) /
      6
    );
  };

  // the straight run into the first knot
  push(xs[0], ys[0], basis(0, 0, cx), basis(0, 0, cy), 0, 0, 0, 0, 1);
  const spans = cx.length - 3;
  for (let i = 0; i < spans; i++) {
    push(cx[i], cy[i], cx[i + 1], cy[i + 1], cx[i + 2], cy[i + 2], cx[i + 3], cy[i + 3], 0);
  }
  // and the straight run out of the last
  push(basis(spans - 1, 1, cx), basis(spans - 1, 1, cy), xs[n - 1], ys[n - 1], 0, 0, 0, 0, 1);
}

/** Draws a basis or bundle curve entirely on the GPU, with no tessellation. */
function drawBasis(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: LineResources,
  points: SceneLinePoint[],
  clip: ReturnType<typeof markClip>,
): void {
  const first = points[0];
  if (!first.stroke || (first.strokeWidth ?? 1) <= 0) {
    return;
  }
  // Batched, so a spec whose curves are one faceted mark each still issues a
  // single draw instead of one per curve.
  // The batch only merges draws whose bind groups are the same object, so this
  // is held rather than rebuilt per curve.
  const uniformBuffer = res.bufferManager.sharedUniformBuffer();
  if (res.basisBindGroup === null || res.basisBindGroupBuffer !== uniformBuffer) {
    res.basisBindGroup = createUniformBindGroup(`${drawName}Basis`, device, res.basisPipeline, uniformBuffer);
    res.basisBindGroupBuffer = uniformBuffer;
  }
  ctx._renderQueue.setupBatch({
    device,
    vertexManager: res.basisVertexManager,
    pipeline: res.basisPipeline,
    clip,
    vertexCount: 6 * BASIS_SUBDIVISIONS,
    bindGroups: [res.basisBindGroup],
  });
  const rows: number[] = [];
  basisInstances(points, rows);
  ctx._renderQueue.queueBatchInstance(rows);
}

/** Curved or gapped lines go through the shared path tessellation. */
function drawPath(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: LineResources,
  points: SceneLinePoint[],
  clip: ReturnType<typeof markClip>,
): void {
  const first = points[0];
  const shapeGeom = lineGeometry(ctx, points);
  const geometry = geometryForItem(ctx, { ...first, fill: undefined }, shapeGeom, true);
  const stroke = Color.from2(first.stroke, first.opacity, first.strokeOpacity);
  const [, strokeData] = geometryVertexData(geometry, [0, 0, 0, 0], stroke);
  if (strokeData.length === 0) {
    return;
  }
  ctx._renderQueue.enqueue({
    pipeline: res.curvePipeline,
    drawCounts: [strokeData.length / res.curveVertexManager.getVertexLength()],
    vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
    bindGroups: [
      createUniformBindGroup(`${drawName}Curve`, device, res.curvePipeline, res.bufferManager.sharedUniformBuffer()),
    ],
    clip,
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items;
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);

  const points = items as SceneLinePoint[];
  const clip = markClip(ctx, scene);

  const pattern = points.length > 0 ? dashPattern(points[0]) : undefined;
  if (pattern) {
    drawDashed(device, ctx, res, points, pattern, clip);
    return;
  }

  if (isBasisCurve(points)) {
    drawBasis(device, ctx, res, points, clip);
    return;
  }

  if (needsPath(points)) {
    drawPath(device, ctx, res, points, clip);
    return;
  }

  if (ctx._renderer.wgOptions.renderBatch === true) {
    // One instanced draw per line mark.
    const blend = blendKey(points[0]?.blend);
    const instancedPipeline =
      blend === 'normal'
        ? res.instancedPipeline
        : markPipeline(ctx, device, `S${drawName} ${blend}`, 'SLine', res.instancedVertexManager, undefined, blend);
    const uniformBindGroup = createUniformBindGroup(
      `S${drawName}`,
      device,
      instancedPipeline,
      res.bufferManager.sharedUniformBuffer(),
    );
    if (items.length < 2) {
      return; // a single point has no segment to draw
    }
    const instanceBuffer = res.bufferManager.createInstanceBuffer(createAttributes(points));

    ctx._renderQueue.enqueue({
      pipeline: instancedPipeline,
      drawCounts: [6, items.length - 1],
      vertexBuffers: [instanceBuffer],
      bindGroups: [uniformBindGroup],
      clip,
    });
  } else {
    // Accumulate segments of consecutive line marks into one draw call
    // (e.g. parallel coordinates). Resolution and offset travel per instance.
    ctx._renderQueue.setupBatch({
      device,
      vertexManager: res.batchVertexManager,
      pipeline: res.batchPipeline,
      clip,
      bindGroups: [],
    });
    const resolution = res.bufferManager.getResolution();
    const offset = res.bufferManager.getOffset();
    const first = points[0];
    const col = Color.from2(first.stroke, first.opacity ?? 1, first.strokeOpacity ?? 1);
    const strokeWidth = first.strokeWidth ?? 1;
    for (let i = 0; i < points.length - 1; i++) {
      const { x = 0, y = 0 } = points[i];
      const x2 = points[i + 1].x ?? 0;
      const y2 = points[i + 1].y ?? 0;

      ctx._renderQueue.queueBatchInstance([
        x,
        y,
        x2,
        y2,
        col[0],
        col[1],
        col[2],
        col[3],
        strokeWidth,
        resolution[0],
        resolution[1],
        offset[0],
        offset[1],
      ]);
    }
  }

  // Round joins: fill the gap at each interior vertex where two segment quads
  // meet at an angle (otherwise the outer corner of every bend is notched).
  if (points.length > 2) {
    const joinData = createJoinAttributes(points);
    if (joinData.length > 0) {
      const joinUniformBindGroup = createUniformBindGroup(
        `${drawName}Join`,
        device,
        res.joinPipeline,
        res.bufferManager.sharedUniformBuffer(),
      );
      ctx._renderQueue.enqueue({
        pipeline: res.joinPipeline,
        drawCounts: [JOIN_SEGMENTS * 3, points.length - 2],
        vertexBuffers: [res.joinGeometryBuffer, res.bufferManager.createInstanceBuffer(joinData)],
        bindGroups: [joinUniformBindGroup],
        clip,
      });
    }
  }
}

/** Symbol-shader instance data for a filled circle at each interior vertex. */
function createJoinAttributes(points: SceneLinePoint[]): Float32Array {
  const count = points.length - 2;
  const result = new Float32Array(count * 12);
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const { x = 0, y = 0, stroke, strokeOpacity = 1, strokeWidth = 1, opacity = 1 } = points[i];
    const col = Color.from2(stroke, opacity, strokeOpacity);
    result[index] = x;
    result[index + 1] = y;
    result[index + 2] = strokeWidth / 2; // radius
    result[index + 3] = col[0];
    result[index + 4] = col[1];
    result[index + 5] = col[2];
    result[index + 6] = col[3];
    // transparent stroke, zero stroke width -> a plain filled circle
    result[index + 11] = 0;
    index += 12;
  }
  return result;
}

/** Unit-circle triangle fan matching the symbol geometry (scaled in-shader). */
function createJoinGeometry(): Float32Array {
  return new Float32Array(
    Array.from({ length: JOIN_SEGMENTS }, (_, i) => {
      const j = (i + 1) % JOIN_SEGMENTS;
      const ang1 = ((Math.PI * 2.0) / JOIN_SEGMENTS) * i;
      const ang2 = ((Math.PI * 2.0) / JOIN_SEGMENTS) * j;
      return [Math.cos(ang1), Math.sin(ang1), 0, 0, Math.cos(ang2), Math.sin(ang2)];
    }).flat(),
  );
}

function createAttributes(points: SceneLinePoint[]): Float32Array {
  const result = new Float32Array((points.length - 1) * 9);
  // A line mark carries one stroke, which is the first item's; canvas strokes
  // the whole path with it. Resolving the colour per segment showed up as the
  // largest single cost on a spec with many short lines.
  const first = points[0];
  const col = Color.from2(first.stroke, first.opacity ?? 1, first.strokeOpacity ?? 1);
  const strokeWidth = first.strokeWidth ?? 1;
  for (let i = 0; i < points.length - 1; i++) {
    const { x = 0, y = 0 } = points[i];
    const x2 = points[i + 1].x ?? 0;
    const y2 = points[i + 1].y ?? 0;

    const index = i * 9;
    result[index] = x;
    result[index + 1] = y;
    result[index + 2] = x2;
    result[index + 3] = y2;
    result[index + 4] = col[0];
    result[index + 5] = col[1];
    result[index + 6] = col[2];
    result[index + 7] = col[3];
    result[index + 8] = strokeWidth;
  }
  return result;
}

export default {
  type: 'line',
  draw,
} satisfies MarkModule;
