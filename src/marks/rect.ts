import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneGradient, SceneItem, SceneRectExt } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey, needsBackdrop } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  outlinePipelines,
  type OutlinePipelines,
  borderInstances,
  boxGradientBounds,
  enqueueOutline,
  outlineTargetOf,
  getMarkResources,
  instanceScratch,
  markClip,
  markItems,
  blendPipelines,
  whiteCarrier,
  type MarkModule,
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
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
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

    const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex, undefined, true);
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
  const items = markItems(scene);
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const clip = markClip(ctx, scene);

  // only materialise the gradient sampler and ramp cache if a gradient shows up
  let gres: ReturnType<typeof getGradientResources> | null = null;
  const gradientResources = () => (gres ??= getGradientResources(device, ctx));
  let run: SceneItem[] = [];
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
      bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer)],
      clip,
    });
    run = [];
  };

  for (const item of items) {
    const fill = (item as SceneRectExt).fill;
    const blend = blendKey((item as SceneRectExt).blend);
    const strokeGradient =
      isGradient((item as SceneRectExt).stroke) && item.bounds
        ? ((item as SceneRectExt).stroke as SceneGradient)
        : null;
    const border = borderInstances(ctx, item as SceneRectExt, strokeGradient);
    // A dash or a ramp takes the border off the analytic path, and the stroke
    // comes off the fill with it so it is not drawn solid underneath.
    const filled: SceneRectExt = border ? { ...(item as SceneRectExt), stroke: undefined } : (item as SceneRectExt);

    // The fill first, which is the order canvas paints them in. How the border
    // draws does not decide this: a ramp needs the gradient pipeline either
    // way, and through the plain one it resolves to the placeholder colour.
    if (isGradient(fill)) {
      flushRun();
      runBlend = blend;
      const gradientPipeline = res.gradientPipelineFor(blend);
      const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes([filled], true));
      ctx._renderQueue.enqueue({
        pipeline: gradientPipeline,
        drawCounts: [6, 1],
        vertexBuffers: [res.geometryBuffer, instanceBuffer],
        bindGroups: [
          createUniformBindGroup(`${drawName}Gradient`, device, gradientPipeline, uniformBuffer),
          createGradientBindGroup(
            gradientResources(),
            gradientPipeline,
            fill,
            boxGradientBounds(item as SceneRectExt),
          ),
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
        outlineTargetOf(ctx, device, res, uniformBuffer, clip),
        border,
        blend,
        strokeGradient,
        item.bounds,
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
    // canvas's fillRect flips a negative extent and paints the rectangle on
    // the other side of x or y, so a quad built from the raw numbers would be
    // inverted and draw nothing where canvas draws a box.
    let x = item.x || 0;
    let y = item.y || 0;
    let width = item.width || 0;
    let height = item.height || 0;
    if (width < 0) {
      x += width;
      width = -width;
    }
    if (height < 0) {
      y += height;
      height = -height;
    }
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

export default {
  type: 'rect',
  draw,
} satisfies MarkModule;
