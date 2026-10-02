import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneItem, SceneRule } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey, needsBackdrop } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import { dashPolyline, type Point } from '../util/dash.js';
import type { RGBA } from '../util/color.js';
import {
  clipMaskView,
  dashPatternOf,
  outlinePipelines,
  type OutlinePipelines,
  enqueueOutline,
  outlineTargetOf,
  getMarkResources,
  markClip,
  markItems,
  blendPipelines,
  segmentInstances,
  strokeEnds,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Rule';

interface RuleResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  /** The quad, one pipeline per blend mode. */
  pipelineFor: (blend: string) => GPURenderPipeline;
  /** Pipelines for an outline drawn through the segment shader. */
  outline: OutlinePipelines;
  geometryBuffer: GPUBuffer;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): RuleResources {
  return getMarkResources(ctx, 'rule', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName);
    const vertexManager = new VertexBufferManager(
      ['float32x2'], // position
      // center, scale, color, half-thickness offset
      ['float32x2', 'float32x2', 'float32x4', 'float32x2'],
    );
    const pipelineFor = blendPipelines(ctx, device, drawName, drawName, vertexManager);
    // A rule with both x2 and y2 set is a diagonal segment, which an
    // axis-aligned quad cannot express. Those go through the single-segment
    // line shader instead.
    const outline = outlinePipelines(ctx, device, `${drawName}Diagonal`);
    const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex, true);
    return {
      device,
      bufferManager,
      pipelineFor,
      outline,
      geometryBuffer,
    };
  });
}

/**
 * A dashed rule as its drawn runs. The rule is two points, so the same walk the
 * line mark uses covers it, and the runs go through the segment shader the
 * diagonal case already uses. An axis-aligned rule takes this path too when it
 * is dashed, since the rect it would otherwise draw has no way to express one.
 */
function dashedAttributes(item: SceneRule, pattern: number[], color: RGBA): Float32Array | null {
  // The raw ends: writeSegments lengthens a square capped run itself, and the
  // dash cuts it into runs whose inner ends are not caps at all.
  const x = item.x || 0;
  const y = item.y || 0;
  const ex = item.x2 == null ? x : item.x2 || 0;
  const ey = item.y2 == null ? y : item.y2 || 0;
  const line: Point[] = [
    [x, y],
    [ex, ey],
  ];
  const ends = strokeEnds(item);
  const runs = dashPolyline(
    line,
    pattern,
    (item as SceneRule & { strokeDashOffset?: number }).strokeDashOffset ?? 0,
    ends.bridge,
  );
  return segmentInstances(runs, color, item.strokeWidth ?? 1, ends.caps, undefined, ends.square);
}

/** True when the rule has no length, so canvas draws nothing under a butt cap. */
function isDegenerate(item: SceneRule): boolean {
  const x = item.x || 0;
  const y = item.y || 0;
  return (item.x2 ?? x) === x && (item.y2 ?? y) === y;
}

/** True when the rule runs at an angle, so it cannot be drawn as a rect. */
function isDiagonal(item: SceneRule): boolean {
  const x = item.x || 0;
  const y = item.y || 0;
  return (item.x2 ?? x) !== x && (item.y2 ?? y) !== y;
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = markItems<SceneRule>(scene);
  if (items.length === 0) {
    return;
  }

  const res = getResources(device, ctx, vb);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const clip = markClip(ctx, scene);

  let run: SceneRule[] = [];
  let runBlend = 'normal';
  const flushRun = () => {
    if (run.length === 0) {
      return;
    }
    const pipeline = res.pipelineFor(runBlend);
    const instanceBuffer = res.bufferManager.createInstanceBuffer(createAttributes(run));
    ctx._renderQueue.enqueue({
      pipeline,
      drawCounts: [6, run.length],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer, clipMaskView(ctx, device))],
      clip,
    });
    run = [];
  };

  for (const item of items) {
    const blend = blendKey(item.blend);
    if (blend !== runBlend && run.length > 0) {
      flushRun();
    }
    runBlend = blend;
    const pattern = dashPatternOf(item);
    // The rect shader draws a rule with a butt end and a solid colour, so a cap
    // or a ramp takes the segment path the diagonal and dashed ones take.
    const strokeGradient = isGradient(item.stroke) && item.bounds ? item.stroke : null;
    const shaped = item.strokeCap === 'round' || item.strokeCap === 'square';
    // canvas moves to the point and lines to the same point, which a butt cap
    // renders as nothing. Falling back to the stroke width for both extents
    // would paint a square block instead.
    if (!shaped && isDegenerate(item)) {
      continue;
    }
    if (!pattern && !isDiagonal(item) && !strokeGradient && !shaped) {
      run.push(item);
      // One draw per item, see needsBackdrop.
      if (needsBackdrop(blend, ctx._opaqueBackdrop)) {
        flushRun();
      }
      continue;
    }
    flushRun();
    const color = strokeGradient
      ? whiteCarrier(item.opacity, item.strokeOpacity)
      : Color.from(item.stroke, item.opacity, item.strokeOpacity);
    const dashed = pattern ? dashedAttributes(item, pattern, color) : null;
    if (pattern && !dashed) {
      continue; // the pattern left nothing drawn
    }
    const data = dashed ?? createDiagonalAttributes(item, color);
    if (!data) {
      continue; // a zero length rule has no segment to draw
    }
    enqueueOutline(outlineTargetOf(ctx, device, res, uniformBuffer, clip), data, blend, strokeGradient, item.bounds);
  }
  flushRun();
}

function createAttributes(items: SceneItem[]): Float32Array {
  return Float32Array.from(
    items.flatMap(item => {
      const { x2, y2, stroke, strokeWidth = 1, opacity = 1, strokeOpacity = 1 } = item as SceneRule;
      const x = item.x || 0;
      const y = item.y || 0;
      const ex = x2 == null ? x : x2 || 0;
      const ey = y2 == null ? y : y2 || 0;
      const ax = Math.abs(ex - x);
      const ay = Math.abs(ey - y);
      const col = Color.from(stroke, opacity, strokeOpacity);
      const w = ax ? ax : strokeWidth;
      const h = ay ? ay : strokeWidth;
      const offX = ax ? 0 : strokeWidth / 2;
      const offY = ay ? 0 : strokeWidth / 2;
      return [Math.min(x, ex), Math.min(y, ey), w, h, ...col, offX, offY];
    }),
  );
}

function createDiagonalAttributes(item: SceneRule, color: RGBA): Float32Array | null {
  const x = item.x || 0;
  const y = item.y || 0;
  const ex = item.x2 == null ? x : item.x2 || 0;
  const ey = item.y2 == null ? y : item.y2 || 0;
  const { caps, join, square } = strokeEnds(item);
  return segmentInstances(
    [
      [
        [x, y],
        [ex, ey],
      ],
    ],
    color,
    item.strokeWidth ?? 1,
    caps,
    join,
    square,
  );
}

export default { draw } satisfies MarkModule;
