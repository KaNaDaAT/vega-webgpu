import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneLinePoint } from '../types/scene.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import { dashPolyline, type Point } from '../util/dash.js';
import { CURVE_SUBDIVISIONS } from '../shaders/curve.js';
import geometryForItem from '../path/geometryForItem.js';
import { line as lineGeometry, lineSpans } from '../path/shapes.js';
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

interface LineResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  segmentVertexManager: VertexBufferManager;
  segmentPipeline: GPURenderPipeline;
  segmentBindGroup: { group: GPUBindGroup; buffer: GPUBuffer } | null;
  curveVertexManager: VertexBufferManager;
  curvePipeline: GPURenderPipeline;
  /** basis and bezier share this layout and differ only in the shader. */
  spanVertexManager: VertexBufferManager;
  spanBindGroups: Map<CurveKind, { group: GPUBindGroup; buffer: GPUBuffer }>;
}

/**
 * The two cubics the GPU evaluates, each with the shader that reads its control
 * points and the packer that produces them.
 */
const CURVES = {
  basis: { shader: 'Curve:basis', instances: basisInstances },
  bezier: { shader: 'Curve:bezier', instances: bezierInstances },
} as const;

type CurveKind = keyof typeof CURVES;

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): LineResources {
  return getMarkResources(ctx, 'line', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const segmentVertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
    const segmentPipeline = markPipeline(ctx, device, drawName, 'SLine', segmentVertexManager);
    const curveVertexManager = new VertexBufferManager(['float32x3', 'float32x4']); // position, color
    const spanVertexManager = new VertexBufferManager(
      [],
      // p0, p1, p2, p3, color, stroke width, kind
      ['float32x2', 'float32x2', 'float32x2', 'float32x2', 'float32x4', 'float32', 'float32'],
    );
    const curvePipeline = markPipeline(ctx, device, `${drawName}Curve`, 'SolidFill', curveVertexManager);
    return {
      curveVertexManager,
      curvePipeline,
      spanVertexManager,
      spanBindGroups: new Map(),
      device,
      bufferManager,
      segmentVertexManager,
      segmentPipeline,
      segmentBindGroup: null,
    };
  });
}

function hasRoundCap(points: SceneLinePoint[]): boolean {
  return points[0]?.strokeCap === 'round';
}

function dashPattern(points: SceneLinePoint[]): number[] | undefined {
  const dash = points[0]?.strokeDash;
  return Array.isArray(dash) && dash.length > 0 ? dash : undefined;
}

/**
 * Queues segment instances into the shared batch. The batch only merges draws
 * whose bind groups are the same object, so it is held rather than rebuilt.
 */
function queueSegments(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: LineResources,
  rows: Float32Array,
  clip: ReturnType<typeof markClip>,
  blend = 'normal',
): void {
  const pipeline =
    blend === 'normal'
      ? res.segmentPipeline
      : markPipeline(ctx, device, `${drawName} ${blend}`, 'SLine', res.segmentVertexManager, undefined, blend);
  const buffer = res.bufferManager.sharedUniformBuffer();
  if (res.segmentBindGroup === null || res.segmentBindGroup.buffer !== buffer) {
    res.segmentBindGroup = { group: createUniformBindGroup(drawName, device, pipeline, buffer), buffer };
  }
  ctx._renderQueue.setupBatch({
    device,
    vertexManager: res.segmentVertexManager,
    pipeline,
    clip,
    bindGroups: [res.segmentBindGroup.group],
  });
  ctx._renderQueue.queueBatchInstance(Array.from(rows));
}

/** True when the points can be drawn as they are, with no curve and no gaps. */
function isPolyline(points: SceneLinePoint[]): boolean {
  const interpolate = points[0]?.interpolate;
  return (!interpolate || interpolate === 'linear') && points.every(p => p.defined !== false);
}

/** Which cubic each interpolation is. Anything absent tessellates. */
const CURVE_OF: Record<string, CurveKind> = {
  basis: 'basis',
  bundle: 'basis',
  cardinal: 'bezier',
  'catmull-rom': 'bezier',
  monotone: 'bezier',
  natural: 'bezier',
};

type LineRoute = CurveKind | 'path' | 'segments';

/**
 * Where an undashed line draws. A square cap needs the tessellated path, since
 * only extrude-polyline draws one, and it outranks the rest. A recognised cubic
 * goes to the GPU as its own control points, so the stroke follows the real
 * curve instead of a flattened polyline. linear and the step family tessellate,
 * which is what gives their corners a join, and so does a line with gaps.
 */
function lineRoute(points: SceneLinePoint[]): LineRoute {
  if (points[0]?.strokeCap === 'square') {
    return 'path';
  }
  const interpolate = points[0]?.interpolate;
  const curve = interpolate === undefined ? undefined : CURVE_OF[interpolate];
  const whole = points.every(p => p.defined !== false);
  if (curve === 'basis' && points.length >= 3 && whole) {
    return 'basis';
  }
  if (curve === 'bezier' && points.length >= 2) {
    return 'bezier';
  }
  return isPolyline(points) ? 'segments' : 'path';
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

  const polylines: Point[][] = isPolyline(points)
    ? [points.map(p => [p.x || 0, p.y || 0] as Point)]
    : lineGeometry(ctx, points).lines.map(line => line.map(p => [p[0], p[1]] as Point));

  const runs = polylines.flatMap(line => dashPolyline(line, pattern, offset));

  const col = Color.from2(first.stroke, first.opacity, first.strokeOpacity);
  const data = segmentInstances(runs, col, first.strokeWidth ?? 1);
  if (!data) {
    return;
  }

  queueSegments(device, ctx, res, data, clip, blendKey(first.blend));
}

/**
 * Instance data for one curve: a span per B-spline segment plus the two
 * straight runs d3's basis opens and closes with. Control points are doubled
 * at each end, which is what puts the first span's start at (5*P0 + P1) / 6.
 *
 * `bundle` blends every point toward the straight chord by its tension first,
 * exactly as d3 does before running basis.
 */
function basisInstances(points: SceneLinePoint[]): number[] {
  const out: number[] = [];
  const first = points[0];
  const n = points.length;
  const beta = first.interpolate === 'bundle' ? (first.tension ?? 0.85) : 1;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const x0 = points[0].x || 0;
  const y0 = points[0].y || 0;
  const dx = (points[n - 1].x || 0) - x0;
  const dy = (points[n - 1].y || 0) - y0;
  for (let i = 0; i < n; i++) {
    const px = points[i].x || 0;
    const py = points[i].y || 0;
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
  return out;
}

/**
 * Instance data for a curve d3 writes as cubic Beziers, collected from the same
 * generator canvas draws through, so the control points are exactly its own.
 * A `moveTo` starts a run, which is how `defined: false` leaves its gaps.
 */
function bezierInstances(points: SceneLinePoint[]): number[] {
  const out: number[] = [];
  const first = points[0];
  const col = Color.from2(first.stroke, first.opacity, first.strokeOpacity);
  const width = first.strokeWidth ?? 1;
  let cx = 0;
  let cy = 0;
  lineSpans(points, {
    moveTo(x, y) {
      cx = x;
      cy = y;
    },
    lineTo(x, y) {
      out.push(cx, cy, x, y, 0, 0, 0, 0, col[0], col[1], col[2], col[3], width, 1);
      cx = x;
      cy = y;
    },
    bezierCurveTo(x1, y1, x2, y2, x, y) {
      out.push(cx, cy, x1, y1, x2, y2, x, y, col[0], col[1], col[2], col[3], width, 0);
      cx = x;
      cy = y;
    },
    closePath() {},
  });
  return out;
}

/**
 * Draws a cubic entirely on the GPU, with no tessellation. Batched, so a spec
 * whose curves are one faceted mark each still issues a single draw.
 */
function drawCurve(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: LineResources,
  points: SceneLinePoint[],
  clip: ReturnType<typeof markClip>,
  kind: CurveKind,
): void {
  const first = points[0];
  if (!first.stroke || (first.strokeWidth ?? 1) <= 0) {
    return;
  }
  const rows = CURVES[kind].instances(points);
  if (rows.length === 0) {
    return;
  }
  const pipeline = markPipeline(ctx, device, `${drawName} ${kind}`, CURVES[kind].shader, res.spanVertexManager);
  // The batch only merges draws whose bind groups are the same object, so this
  // is held rather than rebuilt per curve.
  const buffer = res.bufferManager.sharedUniformBuffer();
  let held = res.spanBindGroups.get(kind);
  if (!held || held.buffer !== buffer) {
    held = { group: createUniformBindGroup(`${drawName} ${kind}`, device, pipeline, buffer), buffer };
    res.spanBindGroups.set(kind, held);
  }
  ctx._renderQueue.setupBatch({
    device,
    vertexManager: res.spanVertexManager,
    pipeline,
    clip,
    vertexCount: 6 * CURVE_SUBDIVISIONS,
    bindGroups: [held.group],
  });
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

  const pattern = dashPattern(points);
  if (pattern) {
    drawDashed(device, ctx, res, points, pattern, clip);
    return;
  }

  const route = lineRoute(points);
  if (route === 'path') {
    drawPath(device, ctx, res, points, clip);
    return;
  }
  if (route !== 'segments') {
    drawCurve(device, ctx, res, points, clip, route);
    return;
  }

  if (points.length < 2) {
    return; // a single point has no segment to draw
  }
  queueSegments(device, ctx, res, createAttributes(points), clip, blendKey(points[0]?.blend));
}

/**
 * Segments of one polyline. Only the earlier segment of an interior vertex
 * rounds its end: that half disc is the round join, and rounding the later
 * segment's start too would blend the same disc twice. A round stroke cap
 * rounds the two outer ends as well.
 */
function createAttributes(points: SceneLinePoint[]): Float32Array {
  const result = new Float32Array((points.length - 1) * SEGMENT_STRIDE);
  // A line mark carries one stroke, which is the first item's; canvas strokes
  // the whole path with it. Resolving the colour per segment showed up as the
  // largest single cost on a spec with many short lines.
  const first = points[0];
  const col = Color.from2(first.stroke, first.opacity ?? 1, first.strokeOpacity ?? 1);
  const strokeWidth = first.strokeWidth ?? 1;
  const round = hasRoundCap(points) ? 1 : 0;
  const last = points.length - 2;
  for (let i = 0; i <= last; i++) {
    const index = i * SEGMENT_STRIDE;
    result[index] = points[i].x || 0;
    result[index + 1] = points[i].y || 0;
    result[index + 2] = points[i + 1].x || 0;
    result[index + 3] = points[i + 1].y || 0;
    result[index + 4] = col[0];
    result[index + 5] = col[1];
    result[index + 6] = col[2];
    result[index + 7] = col[3];
    result[index + 8] = strokeWidth;
    result[index + 9] = i === 0 ? round : 0;
    result[index + 10] = i < last ? 1 : round;
  }
  return result;
}

export default {
  type: 'line',
  draw,
} satisfies MarkModule;
