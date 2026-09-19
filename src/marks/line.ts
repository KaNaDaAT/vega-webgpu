import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneGradient, SceneLinePoint } from '../types/scene.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import { dashPolyline, type Point } from '../util/dash.js';
import { CURVE_SUBDIVISIONS } from '../shaders/curve.js';
import geometryForItem from '../path/geometryForItem.js';
import { line as lineGeometry, lineSpans } from '../path/shapes.js';
import {
  outlinePipelines,
  type OutlinePipelines,
  SEGMENT_STRIDE,
  enqueueOutline,
  outlineTargetOf,
  geometryVertexData,
  getMarkResources,
  markClip,
  blendPipelines,
  markPipeline,
  segmentInstances,
  strokeEnds,
  whiteCarrier,
  writeSegments,
  type MarkModule,
} from './util.js';

const drawName = 'Line';

interface LineResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  /** Pipelines for a segment stroke, which is what a plain line is drawn as. */
  outline: OutlinePipelines;
  segmentBindGroup: { group: GPUBindGroup; buffer: GPUBuffer; pipeline: GPURenderPipeline } | null;
  curveVertexManager: VertexBufferManager;
  /** basis and bezier share this layout and differ only in the shader. */
  spanVertexManager: VertexBufferManager;
  spanBindGroups: Map<string, { group: GPUBindGroup; buffer: GPUBuffer; pipeline: GPURenderPipeline }>;
  /** SolidFill for a tessellated curve, one per blend. */
  curvePipelineFor: (blend: string) => GPURenderPipeline;
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
    const outline = outlinePipelines(ctx, device, drawName);
    const curveVertexManager = new VertexBufferManager(['float32x3', 'float32x4']); // position, color
    const spanVertexManager = new VertexBufferManager(
      [],
      // p0, p1, p2, p3, color, stroke width, kind
      ['float32x2', 'float32x2', 'float32x2', 'float32x2', 'float32x4', 'float32', 'float32'],
    );
    const curvePipelineFor = blendPipelines(ctx, device, `${drawName}Curve`, 'SolidFill', curveVertexManager);
    return {
      curveVertexManager,
      curvePipelineFor,
      spanVertexManager,
      spanBindGroups: new Map(),
      device,
      bufferManager,
      outline,
      segmentBindGroup: null,
    };
  });
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
  const pipeline = res.outline.pipelineFor(blend);
  const buffer = res.bufferManager.sharedUniformBuffer();
  // Keyed by the pipeline as well as the buffer. A bind group belongs to the
  // layout it was made from, so holding one across a change of blend set a
  // group from the normal pipeline on the blended one, which invalidates the
  // whole command buffer: a scene mixing a blended line with an unblended one
  // came out empty, every mark of it.
  const held = res.segmentBindGroup;
  const entry =
    held !== null && held.buffer === buffer && held.pipeline === pipeline
      ? held
      : { group: createUniformBindGroup(drawName, device, pipeline, buffer), buffer, pipeline };
  res.segmentBindGroup = entry;
  ctx._renderQueue.setupBatch({
    device,
    vertexManager: res.outline.vertexManager,
    pipeline,
    clip,
    bindGroups: [entry.group],
  });
  ctx._renderQueue.queueBatchInstance(rows);
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
 * Where an undashed line draws. A recognised cubic goes to the GPU as its own
 * control points, so the stroke follows the real curve instead of a flattened
 * polyline. linear and the step family tessellate, which is what gives their
 * corners a join, and so does a line with gaps. The curve shaders draw no cap,
 * so a square capped curve takes the tessellated path instead.
 */
function lineRoute(points: SceneLinePoint[]): LineRoute {
  const interpolate = points[0]?.interpolate;
  const curve = interpolate === undefined ? undefined : CURVE_OF[interpolate];
  const whole = points.every(p => p.defined !== false);
  const square = points[0]?.strokeCap === 'square';
  if (!square && curve === 'basis' && points.length >= 3 && whole) {
    return 'basis';
  }
  if (!square && curve === 'bezier' && points.length >= 2) {
    return 'bezier';
  }
  return isPolyline(points) ? 'segments' : 'path';
}

/**
 * Dashed lines are split into their drawn runs on the cpu and emitted as plain
 * segments. Curved lines are flattened through the path tessellation first, so
 * the same code covers both.
 */
function drawOutline(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: LineResources,
  points: SceneLinePoint[],
  pattern: number[] | null,
  gradient: SceneGradient | null,
  bounds: Bounds | undefined,
  clip: ReturnType<typeof markClip>,
): void {
  const first = points[0];
  const offset = first.strokeDashOffset ?? 0;

  const polylines: Point[][] = isPolyline(points)
    ? [points.map(p => [p.x || 0, p.y || 0] as Point)]
    : lineGeometry(ctx, points).lines.map(line => line.map(p => [p[0], p[1]] as Point));

  const { caps, join, bridge, square } = strokeEnds(first);
  const runs = pattern ? polylines.flatMap(line => dashPolyline(line, pattern, offset, bridge)) : polylines;

  const col = gradient
    ? whiteCarrier(first.opacity, first.strokeOpacity)
    : Color.from(first.stroke, first.opacity, first.strokeOpacity);
  const data = segmentInstances(runs, col, first.strokeWidth ?? 1, caps, join, square);
  if (!data) {
    return;
  }

  if (!gradient) {
    queueSegments(device, ctx, res, data, clip, blendKey(first.blend));
    return;
  }
  enqueueOutline(
    outlineTargetOf(ctx, device, res, res.bufferManager.sharedUniformBuffer(), clip),
    data,
    blendKey(first.blend),
    gradient,
    bounds,
  );
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

  const col = Color.from(first.stroke, first.opacity, first.strokeOpacity);
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
  const col = Color.from(first.stroke, first.opacity, first.strokeOpacity);
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
  const blend = blendKey(first.blend);
  const pipeline = markPipeline(
    ctx,
    device,
    `${drawName} ${kind} ${blend}`,
    CURVES[kind].shader,
    res.spanVertexManager,
    undefined,
    blend,
  );
  // The batch only merges draws whose bind groups are the same object, so this
  // is held rather than rebuilt per curve. Keyed by the pipeline as well, since
  // a bind group belongs to the layout it was made from.
  const buffer = res.bufferManager.sharedUniformBuffer();
  const cacheKey = `${kind}|${blend}`;
  let held = res.spanBindGroups.get(cacheKey);
  if (!held || held.buffer !== buffer || held.pipeline !== pipeline) {
    held = { group: createUniformBindGroup(`${drawName} ${kind}`, device, pipeline, buffer), buffer, pipeline };
    res.spanBindGroups.set(cacheKey, held);
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
  const stroke = Color.from(first.stroke, first.opacity, first.strokeOpacity);
  const [, strokeData] = geometryVertexData(geometry, [0, 0, 0, 0], stroke);
  if (strokeData.length === 0) {
    return;
  }
  const pipeline = res.curvePipelineFor(blendKey(first.blend));
  ctx._renderQueue.enqueue({
    pipeline,
    drawCounts: [strokeData.length / res.curveVertexManager.getVertexLength()],
    vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
    bindGroups: [createUniformBindGroup(`${drawName}Curve`, device, pipeline, res.bufferManager.sharedUniformBuffer())],
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
  // A ramp cannot come out of the curve or the extruded path either, so a
  // gradient stroke walks the contour the way a dash does.
  const bounds = scene.bounds ?? points[0]?.bounds;
  const strokeGradient = isGradient(points[0]?.stroke) && bounds ? (points[0].stroke as SceneGradient) : null;
  if (pattern || strokeGradient) {
    drawOutline(device, ctx, res, points, pattern ?? null, strokeGradient, bounds, clip);
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
 * Segments of one polyline, with a join at every vertex between the two ends.
 * Both segments at a vertex are cut against the same bisector, so the corner is
 * mitered and neither draws over the other.
 */
function createAttributes(points: SceneLinePoint[]): Float32Array {
  const result = new Float32Array((points.length - 1) * SEGMENT_STRIDE);
  // A line mark carries one stroke, which is the first item's; canvas strokes
  // the whole path with it. Resolving the colour per segment showed up as the
  // largest single cost on a spec with many short lines.
  const first = points[0];
  const col = Color.from(first.stroke, first.opacity ?? 1, first.strokeOpacity ?? 1);
  const run: Point[] = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    run[i] = [points[i].x || 0, points[i].y || 0];
  }
  const { caps, join, square } = strokeEnds(first);
  writeSegments(result, 0, [run], col, first.strokeWidth ?? 1, caps, join, square);
  return result;
}

export default {
  type: 'line',
  draw,
} satisfies MarkModule;
