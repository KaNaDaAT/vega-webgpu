import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneRule } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import type { Point } from '../types/geometry.js';
import type { RGBA } from '../util/color.js';
import {
  dashPatternOf,
  outlinePipelines,
  type OutlinePipelines,
  enqueueOutline,
  getMarkResources,
  markItems,
  blendPipelines,
  segmentInstances,
  strokeEnds,
  strokeRuns,
  type MarkModule,
  uniformBindGroup,
  paintColour,
  rampOf,
  targetOf,
} from './util.js';
import { DrawRun } from '../util/drawRun.js';

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

/** A rule's two ends. An unset x2 or y2 is its start, the way vega draws one. */
function ruleEnds(item: SceneRule): [x: number, y: number, ex: number, ey: number] {
  const x = item.x || 0;
  const y = item.y || 0;
  return [x, y, item.x2 == null ? x : item.x2 || 0, item.y2 == null ? y : item.y2 || 0];
}

/**
 * A rule drawn through the segment shader, for what the rect cannot draw: a
 * dash, a diagonal, a cap or a ramp. The rule is two points, so the walk the
 * line mark dashes with covers it. The raw ends: writeSegments lengthens a
 * square capped run itself, and a dash cuts it into runs whose inner ends are
 * not caps at all.
 */
function segmentAttributes(item: SceneRule, color: RGBA): Float32Array | null {
  const [x, y, ex, ey] = ruleEnds(item);
  const line: Point[] = [
    [x, y],
    [ex, ey],
  ];
  return segmentInstances(strokeRuns([line], item), color, item.strokeWidth ?? 1, strokeEnds(item));
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

  const run = new DrawRun<SceneRule>(ctx._opaqueBackdrop, (rules, blend) => {
    const pipeline = res.pipelineFor(blend);
    const instanceBuffer = res.bufferManager.createInstanceBuffer(createAttributes(rules));
    ctx._renderQueue.enqueue({
      pipeline,
      drawCounts: [6, rules.length],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [uniformBindGroup(ctx, device, drawName, pipeline, uniformBuffer)],
      clip: ctx._clip,
    });
  });

  for (const item of items) {
    const blend = blendKey(item.blend);
    const pattern = dashPatternOf(item);
    // The rect shader draws a rule with a butt end and a solid colour, so a cap
    // or a ramp takes the segment path the diagonal and dashed ones take.
    const strokeRamp = rampOf(item.stroke, item.bounds);
    const shaped = item.strokeCap === 'round' || item.strokeCap === 'square';
    // canvas moves to the point and lines to the same point, which a butt cap
    // renders as nothing. Falling back to the stroke width for both extents
    // would paint a square block instead.
    if (!shaped && isDegenerate(item)) {
      continue;
    }
    if (!pattern && !isDiagonal(item) && !strokeRamp && !shaped) {
      run.add(item, blend);
      continue;
    }
    run.flush();
    const color = paintColour(item.stroke, item.opacity, item.strokeOpacity, strokeRamp);
    const data = segmentAttributes(item, color);
    if (!data) {
      continue; // a zero length rule, or a dash that left nothing drawn
    }
    enqueueOutline(
      targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, uniformBuffer),
      data,
      strokeRamp,
      blend,
    );
  }
  run.flush();
}

function createAttributes(items: SceneRule[]): Float32Array {
  return Float32Array.from(
    items.flatMap(item => {
      const { stroke, strokeWidth = 1, opacity = 1, strokeOpacity = 1 } = item;
      const [x, y, ex, ey] = ruleEnds(item);
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

export default { draw } satisfies MarkModule;
