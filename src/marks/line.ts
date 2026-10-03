import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneLinePoint } from '../types/scene.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import type { Point } from '../types/geometry.js';
import { CURVE_SUBDIVISIONS } from '../shaders/curve.js';
import { BUTT_END, ROUND_END } from '../util/join.js';
import geometryForItem from '../path/geometryForItem.js';
import { line as lineGeometry, lineSpans } from '../path/shapes.js';
import {
  clipMaskView,
  outlinePipelines,
  type OutlinePipelines,
  SEGMENT_STRIDE,
  enqueueOutline,
  vertexData,
  getMarkResources,
  blendPipelines,
  markPipeline,
  segmentInstances,
  strokeEnds,
  strokeRuns,
  writeSegments,
  type MarkModule,
  uniformBindGroup,
  paintColour,
  rampOf,
  targetOf,
  type Ramp,
} from './util.js';

const drawName = 'Line';

/**
 * A group 0 bind group kept across draws, with everything it was built from.
 *
 * The clip mask belongs in there as much as the buffer and the pipeline do.
 * The uniform block only says whether a mask is bound, so two marks in one
 * group that each carry a clip path of their own share a uniform buffer, and
 * the second was drawn cut by the first one's coverage.
 */
interface HeldBindGroup {
  group: GPUBindGroup;
  buffer: GPUBuffer;
  pipeline: GPURenderPipeline;
  mask: GPUTextureView;
}

interface LineResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  /** Pipelines for a segment stroke, which is what a plain line is drawn as. */
  outline: OutlinePipelines;
  segmentBindGroup: HeldBindGroup | null;
  curveVertexManager: VertexBufferManager;
  /** basis and bezier share this layout and differ only in the shader. */
  spanVertexManager: VertexBufferManager;
  spanBindGroups: Map<string, HeldBindGroup>;
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
    const bufferManager = new BufferManager(device, drawName);
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
  blend = 'normal',
): void {
  const pipeline = res.outline.pipelineFor(blend);
  const buffer = res.bufferManager.sharedUniformBuffer();
  // Keyed by the pipeline as well as the buffer. A bind group belongs to the
  // layout it was made from, so holding one across a change of blend set a
  // group from the normal pipeline on the blended one, which invalidates the
  // whole command buffer: a scene mixing a blended line with an unblended one
  // came out empty, every mark of it.
  const mask = clipMaskView(ctx, device);
  const held = res.segmentBindGroup;
  const entry =
    held !== null && held.buffer === buffer && held.pipeline === pipeline && held.mask === mask
      ? held
      : {
          group: createUniformBindGroup(drawName, device, pipeline, buffer, mask),
          buffer,
          pipeline,
          mask,
        };
  res.segmentBindGroup = entry;
  ctx._renderQueue.setupBatch({
    device,
    vertexManager: res.outline.vertexManager,
    pipeline,
    clip: ctx._clip,
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
 * corners a join, and so does a line with gaps.
 *
 * The curve shaders draw no cap of their own. A square one takes the
 * tessellated path, which draws it exactly. A round one stays on the curve and
 * `drawCurve` adds the two discs, since the tessellated route's flattening is
 * further from canvas than a cap is worth: routing there doubles the differing
 * pixels on line-curve-caps.
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
  ramp: Ramp | null,
): void {
  const first = points[0];
  const polylines: Point[][] = isPolyline(points)
    ? [points.map(p => [p.x || 0, p.y || 0] as Point)]
    : lineGeometry(ctx, points).lines;

  const col = paintColour(first.stroke, first.opacity, first.strokeOpacity, ramp);
  const data = segmentInstances(strokeRuns(polylines, first), col, first.strokeWidth ?? 1, strokeEnds(first));
  if (!data) {
    return;
  }

  const blend = blendKey(first.blend);
  if (!ramp) {
    queueSegments(device, ctx, res, data, blend);
    return;
  }
  enqueueOutline(
    targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, res.bufferManager.sharedUniformBuffer()),
    data,
    ramp,
    blend,
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
function basisInstances(points: SceneLinePoint[], stubs: CapStubs): number[] {
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
  const knot0: Point = [basis(0, 0, cx), basis(0, 0, cy)];
  push(xs[0], ys[0], knot0[0], knot0[1], 0, 0, 0, 0, 1);
  const spans = cx.length - 3;
  for (let i = 0; i < spans; i++) {
    push(cx[i], cy[i], cx[i + 1], cy[i + 1], cx[i + 2], cy[i + 2], cx[i + 3], cy[i + 3], 0);
  }
  // and the straight run out of the last
  const knotN: Point = [basis(spans - 1, 1, cx), basis(spans - 1, 1, cy)];
  push(knotN[0], knotN[1], xs[n - 1], ys[n - 1], 0, 0, 0, 0, 1);

  // basis takes a whole line, so there is one run and these are its ends
  const head: Point = [xs[0], ys[0]];
  const tail: Point = [xs[n - 1], ys[n - 1]];
  stubs.open(head, [[knot0[0] - head[0], knot0[1] - head[1]]]);
  stubs.extend(tail, [[tail[0] - knotN[0], tail[1] - knotN[1]]]);
  return out;
}

/**
 * Instance data for a curve d3 writes as cubic Beziers, collected from the same
 * generator canvas draws through, so the control points are exactly its own.
 * A `moveTo` starts a run, which is how `defined: false` leaves its gaps.
 */
function bezierInstances(points: SceneLinePoint[], stubs: CapStubs): number[] {
  const out: number[] = [];
  const first = points[0];
  const col = Color.from(first.stroke, first.opacity, first.strokeOpacity);
  const width = first.strokeWidth ?? 1;
  let cx = 0;
  let cy = 0;
  // A moveTo starts a run, which is how `defined: false` leaves its gaps, and
  // canvas caps every run rather than only the first and the last.
  let opening = false;
  const leave = (towards: readonly Point[]): void => {
    if (opening) {
      stubs.open([cx, cy], towards);
      opening = false;
    }
  };
  lineSpans(points, {
    moveTo(x, y) {
      cx = x;
      cy = y;
      opening = true;
    },
    lineTo(x, y) {
      leave([[x - cx, y - cy]]);
      out.push(cx, cy, x, y, 0, 0, 0, 0, col[0], col[1], col[2], col[3], width, 1);
      stubs.extend([x, y], [[x - cx, y - cy]]);
      cx = x;
      cy = y;
    },
    bezierCurveTo(x1, y1, x2, y2, x, y) {
      leave([
        [x1 - cx, y1 - cy],
        [x2 - cx, y2 - cy],
        [x - cx, y - cy],
      ]);
      out.push(cx, cy, x1, y1, x2, y2, x, y, col[0], col[1], col[2], col[3], width, 0);
      stubs.extend(
        [x, y],
        [
          [x - x2, y - y2],
          [x - x1, y - y1],
          [x - cx, y - cy],
        ],
      );
      cx = x;
      cy = y;
    },
    closePath() {},
  });
  return out;
}

/**
 * How far a cap stub runs past its end point, in scene units. The disc is
 * centred on the far end, so this is also how much further the cap reaches
 * than canvas draws it, which at a tenth of a device pixel is under the grid.
 */
const CAP_STUB = 0.05;

/** Unit vector along the first of these that has a length, or null. */
function firstDirection(deltas: readonly Point[]): Point | null {
  for (const [dx, dy] of deltas) {
    const len = Math.hypot(dx, dy);
    if (len > 1e-9) {
      return [dx / len, dy / len];
    }
  }
  return null;
}

/**
 * Collects the round caps a curve route does not draw.
 *
 * The curve shaders cover the stroke across its width and stop at the end
 * points, so the disc canvas adds at each end of each run has to come from
 * somewhere else. Each is a two point stub along the end tangent, pointing
 * away from the curve, drawn through the segment shader with a butt at the end
 * point and a round cap at the far end. The butt keeps it to the half beyond
 * the curve: a whole disc would sit over the curve body as well and composite
 * twice there under any mode that reads the frame back.
 *
 * The writers report their own runs rather than the stubs being read back out
 * of the instance rows. A basis span carries four B-spline control points, and
 * a span starts at (P0 + 4*P1 + P2) / 6 rather than at P0, so rows alone
 * cannot say where one run ends and the next begins.
 */
class CapStubs {
  private stubs: Point[][] = [];
  private at: Point | null = null;
  private from: Point | null = null;

  /**
   * A run leaves `at`, heading along the first of `towards` that has a length.
   * A cubic can repeat its endpoint as a control point, so the tangent is a
   * list rather than one delta: taking the first alone leaves that end with no
   * cap at all.
   */
  open(at: Point, towards: readonly Point[]): void {
    this.close();
    const ahead = firstDirection(towards);
    this.at = at;
    this.from = ahead && [-ahead[0], -ahead[1]];
  }

  /** The run now reaches `at`, arriving along the first of `towards`. */
  extend(at: Point, towards: readonly Point[]): void {
    this.last = { at, direction: firstDirection(towards) };
  }

  private last: { at: Point; direction: Point | null } | null = null;

  private push(at: Point, outward: Point | null): void {
    if (outward) {
      this.stubs.push([at, [at[0] + outward[0] * CAP_STUB, at[1] + outward[1] * CAP_STUB]]);
    }
  }

  private close(): void {
    if (this.at && this.last) {
      this.push(this.at, this.from);
      this.push(this.last.at, this.last.direction);
    }
    this.at = null;
    this.last = null;
  }

  done(): Point[][] {
    this.close();
    return this.stubs;
  }
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
  kind: CurveKind,
): void {
  const first = points[0];
  if (!first.stroke || (first.strokeWidth ?? 1) <= 0) {
    return;
  }
  const stubs = new CapStubs();
  const rows = CURVES[kind].instances(points, stubs);
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
  const mask = clipMaskView(ctx, device);
  let held = res.spanBindGroups.get(cacheKey);
  if (!held || held.buffer !== buffer || held.pipeline !== pipeline || held.mask !== mask) {
    held = {
      group: createUniformBindGroup(`${drawName} ${kind}`, device, pipeline, buffer, mask),
      buffer,
      pipeline,
      mask,
    };
    res.spanBindGroups.set(cacheKey, held);
  }
  ctx._renderQueue.setupBatch({
    device,
    vertexManager: res.spanVertexManager,
    pipeline,
    clip: ctx._clip,
    vertexCount: 6 * CURVE_SUBDIVISIONS,
    bindGroups: [held.group],
  });
  ctx._renderQueue.queueBatchInstance(rows);

  if (first.strokeCap === 'round') {
    const caps = segmentInstances(
      stubs.done(),
      Color.from(first.stroke, first.opacity, first.strokeOpacity),
      first.strokeWidth ?? 1,
      { ...strokeEnds(first), caps: [BUTT_END, ROUND_END] },
    );
    if (caps) {
      queueSegments(device, ctx, res, caps, blend);
    }
  }
}

/** Curved or gapped lines go through the shared path tessellation. */
function drawPath(device: GPUDevice, ctx: GPUVegaCanvasContext, res: LineResources, points: SceneLinePoint[]): void {
  const first = points[0];
  const shapeGeom = lineGeometry(ctx, points);
  const geometry = geometryForItem(ctx, { ...first, fill: undefined }, shapeGeom, true);
  const stroke = Color.from(first.stroke, first.opacity, first.strokeOpacity);
  const strokeData = vertexData(geometry.strokeTriangles, geometry.strokeCount, stroke);
  if (strokeData.length === 0) {
    return;
  }
  const pipeline = res.curvePipelineFor(blendKey(first.blend));
  ctx._renderQueue.enqueue({
    pipeline,
    drawCounts: [strokeData.length / res.curveVertexManager.getVertexLength()],
    vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
    bindGroups: [uniformBindGroup(ctx, device, `${drawName}Curve`, pipeline, res.bufferManager.sharedUniformBuffer())],
    clip: ctx._clip,
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items;
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);

  const points = items as SceneLinePoint[];

  const pattern = dashPattern(points);
  // A ramp cannot come out of the curve or the extruded path either, so a
  // gradient stroke walks the contour the way a dash does.
  const bounds = scene.bounds ?? points[0]?.bounds;
  const strokeRamp = rampOf(points[0]?.stroke, bounds);
  if (pattern || strokeRamp) {
    drawOutline(device, ctx, res, points, strokeRamp);
    return;
  }

  const route = lineRoute(points);
  if (route === 'path') {
    drawPath(device, ctx, res, points);
    return;
  }
  if (route !== 'segments') {
    drawCurve(device, ctx, res, points, route);
    return;
  }

  if (points.length < 2) {
    return; // a single point has no segment to draw
  }
  queueSegments(device, ctx, res, createAttributes(points), blendKey(points[0]?.blend));
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
  writeSegments(result, 0, [run], col, first.strokeWidth ?? 1, strokeEnds(first));
  return result;
}

export default { draw } satisfies MarkModule;
