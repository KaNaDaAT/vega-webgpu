import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneItem, SceneRectExt } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey, needsBackdrop } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import {
  rectBox,
  outlinePipelines,
  type OutlinePipelines,
  borderInstances,
  enqueueOutline,
  getMarkResources,
  instanceScratch,
  markClip,
  markItems,
  blendPipelines,
  whiteCarrier,
  type MarkModule,
  uniformBindGroup,
  boxRampOf,
  targetOf,
} from './util.js';

const drawName = 'Rect';

interface RectResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  gradientPipelineFor: (blend: string) => GPURenderPipeline;
  geometryBuffer: GPUBuffer;
  /** The background, one pipeline per blend mode. */
  pipelineFor: (blend: string) => GPURenderPipeline;
  /** Pipelines for an outline drawn through the segment shader. */
  outline: OutlinePipelines;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): RectResources {
  return getMarkResources(ctx, 'rect', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName);
    const vertexManager = new VertexBufferManager(
      ['float32x2'], // position
      // center, dimensions, fill color, stroke color, stroke width, corner radii
      ['float32x2', 'float32x2', 'float32x4', 'float32x4', 'float32', 'float32x4'],
    );
    // a gradient fill under a blend needs its own pipeline too
    const gradientPipelineFor = blendPipelines(
      ctx,
      device,
      `${drawName}Gradient`,
      'Rect',
      vertexManager,
      'main_fragment_gradient',
    );

    // The analytic stroke cannot express a pattern, so a dashed border is
    // walked as a polyline and drawn as segments, the way a group's is.
    const outline = outlinePipelines(ctx, device, `${drawName}Dash`);

    const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex, true);
    return {
      device,
      bufferManager,
      gradientPipelineFor,
      geometryBuffer,
      pipelineFor: blendPipelines(ctx, device, drawName, 'Rect', vertexManager),
      outline,
    };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = markItems<SceneRectExt>(scene);
  if (items.length === 0) {
    return;
  }

  const res = getResources(device, ctx, vb);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const clip = markClip(ctx, scene);

  // only materialise the gradient sampler and ramp cache if a gradient shows up
  let gres: ReturnType<typeof getGradientResources> | null = null;
  const gradientResources = () => (gres ??= getGradientResources(device, ctx));
  let run: SceneRectExt[] = [];
  let runBlend = 'normal';
  const flushRun = () => {
    if (run.length === 0) {
      return;
    }
    const pipeline = res.pipelineFor(runBlend);
    const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes(run));
    ctx._renderQueue.enqueue({
      pipeline,
      drawCounts: [6, run.length],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [uniformBindGroup(ctx, device, drawName, pipeline, uniformBuffer)],
      clip,
    });
    run = [];
  };

  for (const item of items) {
    const blend = blendKey(item.blend);
    const fillRamp = boxRampOf(item.fill, item);
    const strokeRamp = boxRampOf(item.stroke, item);
    const border = borderInstances(ctx, item, strokeRamp);
    // A dash or a ramp takes the border off the analytic path, and the stroke
    // comes off the fill with it so it is not drawn solid underneath.
    const filled: SceneRectExt = border ? { ...item, stroke: undefined } : item;

    // The fill first, which is the order canvas paints them in. How the border
    // draws does not decide this: a ramp needs the gradient pipeline either
    // way, and through the plain one it resolves to the placeholder colour.
    if (fillRamp) {
      flushRun();
      runBlend = blend;
      const gradientPipeline = res.gradientPipelineFor(blend);
      const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes([filled], true));
      ctx._renderQueue.enqueue({
        pipeline: gradientPipeline,
        drawCounts: [6, 1],
        vertexBuffers: [res.geometryBuffer, instanceBuffer],
        bindGroups: [
          uniformBindGroup(ctx, device, `${drawName}Gradient`, gradientPipeline, uniformBuffer),
          createGradientBindGroup(gradientResources(), gradientPipeline, fillRamp.gradient, fillRamp.bounds),
        ],
        clip,
      });
    } else {
      // a run shares one pipeline, so a change of blend starts a new one
      if (blend !== runBlend && run.length > 0) {
        flushRun();
      }
      runBlend = blend;
      run.push(filled);
      // The border draws after the fill, so the run closes here. canvas also
      // composites each mark against what is already there, so two blended
      // ones overlapping have to meet the frame one at a time.
      if (border || needsBackdrop(blend, ctx._opaqueBackdrop)) {
        flushRun();
      }
    }

    if (border) {
      enqueueOutline(
        targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, uniformBuffer, clip),
        border,
        strokeRamp,
        blend,
      );
    }
  }
  flushRun();
}

/** Floats per rect instance: box, fill, stroke, stroke width, four radii. */
const RECT_STRIDE = 17;

export function rectAttributes(items: SceneItem[], whiteGradientFill = false): Float32Array {
  const out = instanceScratch(items.length * RECT_STRIDE);
  for (let i = 0, len = items.length; i < len; i++) {
    const item = items[i] as SceneRectExt;
    const {
      opacity = 1,
      fill,
      fillOpacity = 1,
      stroke,
      strokeOpacity = 1,
      strokeWidth,
      cornerRadius = 0,
      cornerRadiusBottomLeft,
      cornerRadiusBottomRight,
      cornerRadiusTopRight,
      cornerRadiusTopLeft,
    } = item;
    // a quad built from a negative extent would be inverted and draw nothing
    const [x, y, width, height] = rectBox(item);
    const base = i * RECT_STRIDE;
    out[base] = x;
    out[base + 1] = y;
    out[base + 2] = width;
    out[base + 3] = height;
    if (whiteGradientFill && isGradient(fill)) {
      const [r, g, b, a] = whiteCarrier(opacity, fillOpacity);
      out[base + 4] = r;
      out[base + 5] = g;
      out[base + 6] = b;
      out[base + 7] = a;
    } else {
      Color.write(out, base + 4, fill, opacity, fillOpacity);
    }
    Color.write(out, base + 8, stroke, opacity, strokeOpacity);
    // Only reserve stroke width when a stroke is actually painted. Vega marks
    // may carry a strokeWidth with no stroke (e.g. stroke set on hover only);
    // canvas ignores it, so we must too. Otherwise the transparent stroke
    // band insets the fill and the rect renders ~strokeWidth/2 px too small.
    out[base + 12] = stroke ? (strokeWidth ?? 1) : 0;
    out[base + 13] = cornerRadiusTopRight ?? cornerRadius;
    out[base + 14] = cornerRadiusBottomRight ?? cornerRadius;
    out[base + 15] = cornerRadiusBottomLeft ?? cornerRadius;
    out[base + 16] = cornerRadiusTopLeft ?? cornerRadius;
  }
  return out;
}

export default { draw } satisfies MarkModule;
