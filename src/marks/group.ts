import { Bounds, sceneVisit } from 'vega-scenegraph';
import type { ClipRect, GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneGradient, SceneGroupExt } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { blendKey } from '../util/blend.js';
import { isGradient } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import { rectAttributes } from './rect.js';
import {
  outlinePipelines,
  type OutlinePipelines,
  borderInstances,
  enqueueOutline,
  outlineTargetOf,
  withStrokeOffset,
  getMarkResources,
  blendPipelines,
  type MarkModule,
} from './util.js';
import type WebGPURenderer from '../WebGPURenderer.js';

const drawName = 'Group';

interface GroupResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  /** The background rect, one pipeline per blend mode. */
  pipelineFor: (blend: string) => GPURenderPipeline;
  gradientPipelineFor: (blend: string) => GPURenderPipeline;
  /** Pipelines for an outline drawn through the segment shader. */
  outline: OutlinePipelines;
  geometryBuffer: GPUBuffer;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): GroupResources {
  return getMarkResources(ctx, 'group', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x2'], // position
      // center, dimensions, fill color, stroke color, stroke width, corner radii
      ['float32x2', 'float32x2', 'float32x4', 'float32x4', 'float32', 'float32x4'],
    );
    // the background is a rect, and a blend is baked into the pipeline state
    const pipelineFor = blendPipelines(ctx, device, `${drawName}`, 'Rect', vertexManager);
    // a gradient fill under a blend needs its own pipeline too
    const gradientPipelineFor = blendPipelines(
      ctx,
      device,
      `${drawName}Gradient`,
      'Rect',
      vertexManager,
      'main_fragment_gradient',
    );

    const outline = outlinePipelines(ctx, device, `${drawName}Dash`);
    const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex, undefined, true);
    return {
      device,
      bufferManager,
      pipelineFor,
      gradientPipelineFor,
      outline,
      geometryBuffer,
    };
  });
}

function draw(
  this: WebGPURenderer,
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  scene: GPUVegaScene,
  vb: Bounds,
  markTypes?: string[],
): void {
  const items = scene.items;
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  // Held borders draw after their children, by which point the visit has put
  // the clip back to what it was, so both passes take the same one.
  const parentClip = ctx._clip;

  const uniformBuffer = res.bufferManager.createUniformBuffer();

  // Group backgrounds share the rect instance layout and shader.
  // only materialise the gradient sampler and ramp cache if a gradient shows up
  let gres: ReturnType<typeof getGradientResources> | null = null;
  const gradientResources = () => (gres ??= getGradientResources(device, ctx));
  let run: SceneGroupExt[] = [];
  // one run draws with one pipeline, so a change of blend closes it
  let runBlend = 'normal';
  const flushRun = () => {
    if (run.length === 0) {
      return;
    }
    const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes(run));
    // Each blend gets its own pipeline, and a pipeline built with a default
    // layout owns its bind group layout, so the group has to come from the one
    // this draw actually uses.
    const runPipeline = res.pipelineFor(runBlend);
    ctx._renderQueue.enqueue({
      pipeline: runPipeline,
      drawCounts: [6, run.length],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [createUniformBindGroup(drawName, device, runPipeline, uniformBuffer)],
      clip: ctx._clip,
    });
    run = [];
  };

  /** Borders held back until after the backgrounds, which is the order canvas paints them in. */
  const dashed: { data: Float32Array; gradient: SceneGradient | null; bounds: Bounds | undefined; blend: string }[] =
    [];
  /** Where a border that carries its own ramp is enqueued, one draw each. */
  const outlineTarget = (clip: ClipRect | undefined) => outlineTargetOf(ctx, device, res, uniformBuffer, clip);
  // A group asking for strokeForeground has its border held back and enqueued
  // after its own children, which is where vega draws it.
  const held = new Map<
    SceneGroupExt,
    { rect: SceneGroupExt; dash: Float32Array | null; gradient: SceneGradient | null }
  >();

  /** One group's background, and the border that goes under its children. */
  const paintBackdrop = (item: SceneGroupExt): void => {
    const edged = withStrokeOffset(item);
    const strokeGradient = isGradient(item.stroke) && item.bounds ? (item.stroke as SceneGradient) : null;
    const border = borderInstances(ctx, edged, strokeGradient);
    const fore = item.strokeForeground === true && item.stroke != null;
    if (fore) {
      held.set(item, { rect: { ...edged, fill: undefined }, dash: border, gradient: strokeGradient });
    } else if (border) {
      dashed.push({ data: border, gradient: strokeGradient, bounds: item.bounds, blend: blendKey(item.blend) });
    }
    const drawn = border || fore ? { ...edged, stroke: undefined } : edged;
    const fill = drawn.fill;
    const blend = blendKey(item.blend);
    if (!isGradient(fill)) {
      if (run.length && blend !== runBlend) {
        flushRun();
      }
      runBlend = blend;
      run.push(drawn);
      return;
    }
    flushRun();
    const gradientPipeline = res.gradientPipelineFor(blendKey(item.blend));
    const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes([drawn], true));
    ctx._renderQueue.enqueue({
      pipeline: gradientPipeline,
      drawCounts: [6, 1],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [
        createUniformBindGroup(`${drawName}Gradient`, device, gradientPipeline, uniformBuffer),
        createGradientBindGroup(gradientResources(), gradientPipeline, fill, [0, 0, 1, 1]),
      ],
      clip: ctx._clip,
    });
  };

  const flushDashed = (): void => {
    for (const entry of dashed) {
      enqueueOutline(outlineTarget(ctx._clip), entry.data, entry.blend, entry.gradient, entry.bounds);
    }
    dashed.length = 0;
  };

  // vega draws each group's background, then its children, then the next group.
  // Every background in one instanced draw reverses that wherever a later group
  // covers what an earlier one drew, so the batch is kept only when nothing
  // overlaps, which is what a row of panels looks like.
  const interleaved = groupsOverlap(items as SceneGroupExt[]);
  if (!interleaved) {
    for (const item of items as SceneGroupExt[]) {
      paintBackdrop(item);
    }
    flushRun();
    flushDashed();
  }

  sceneVisit(scene, (group: SceneGroupExt) => {
    if (interleaved) {
      paintBackdrop(group);
      flushRun();
      flushDashed();
    }
    const gx = group.x || 0;
    const gy = group.y || 0;
    const gw = group.width || 0;
    const gh = group.height || 0;

    // accumulate the group translation for nested marks
    ctx._tx += gx;
    ctx._ty += gy;

    const oldClip = ctx._clip;
    if (group.clip) {
      const dpi = ctx._uniforms.dpi;
      ctx._clip = [(ctx._origin[0] + ctx._tx) * dpi, (ctx._origin[1] + ctx._ty) * dpi, gw * dpi, gh * dpi];
    }
    if (vb) {
      vb.translate(-gx, -gy);
    }

    sceneVisit(group, (item: GPUVegaScene) => {
      if (item.marktype === 'group' || markTypes == null || markTypes.includes(item.marktype)) {
        this.draw(device, ctx, item, vb, markTypes);
      }
    });

    if (vb) {
      vb.translate(gx, gy);
    }
    if (group.clip) {
      ctx._clip = oldClip;
    }
    ctx._tx -= gx;
    ctx._ty -= gy;

    const fore = held.get(group);
    if (fore) {
      if (fore.dash) {
        enqueueOutline(outlineTarget(parentClip), fore.dash, blendKey(fore.rect.blend), fore.gradient, group.bounds);
      } else {
        // A bind group belongs to the layout of the pipeline it was made from,
        // so a held border under a blend cannot take the plain one.
        const forePipeline = res.pipelineFor(blendKey(fore.rect.blend));
        ctx._renderQueue.enqueue({
          pipeline: forePipeline,
          drawCounts: [6, 1],
          vertexBuffers: [res.geometryBuffer, res.bufferManager.createInstanceBuffer(rectAttributes([fore.rect]))],
          bindGroups: [createUniformBindGroup(drawName, device, forePipeline, uniformBuffer)],
          clip: parentClip,
        });
      }
    }
  });
}

/**
 * Whether any group's background lands on another's contents, so the order the
 * two are drawn in shows.
 *
 * A group's `bounds` covers its children as well as its own box, which is what
 * makes this more than a box test: a panel's axis labels reach outside it, and
 * the next panel's background paints over them.
 *
 * Pairwise, since a group mark is panels rather than data points. Past the
 * limit it answers yes without looking, which is the order vega draws in and
 * only costs the batch.
 */
const OVERLAP_CHECK_LIMIT = 2048;

function groupsOverlap(items: SceneGroupExt[]): boolean {
  const n = items.length;
  if (n < 2) {
    return false;
  }
  if (n > OVERLAP_CHECK_LIMIT) {
    return true;
  }
  for (let j = 1; j < n; j++) {
    for (let i = 0; i < j; i++) {
      if (paintsOver(items[j], items[i]) || paintsOver(items[i], items[j])) {
        return true;
      }
    }
  }
  return false;
}

/** True when `a` paints a backdrop at all and its box reaches into `b`. */
function paintsOver(a: SceneGroupExt, b: SceneGroupExt): boolean {
  if (!a.fill && !(a.stroke && a.strokeForeground !== true)) {
    return false;
  }
  const bounds = b.bounds;
  if (!bounds) {
    return false;
  }
  const x1 = a.x || 0;
  const y1 = a.y || 0;
  return x1 < bounds.x2 && x1 + (a.width || 0) > bounds.x1 && y1 < bounds.y2 && y1 + (a.height || 0) > bounds.y1;
}

export default {
  type: 'group',
  draw,
} satisfies MarkModule;
