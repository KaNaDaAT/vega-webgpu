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
  enqueueOutline,
  getMarkResources,
  markClip,
  blendPipelines,
  markPipeline,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Rect';

interface RectResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
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
    const pipeline = markPipeline(ctx, device, drawName, 'Rect', vertexManager);
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
      vertexManager,
      pipeline,
      gradientPipelineFor,
      geometryBuffer,
      pipelineFor: blendPipelines(ctx, device, drawName, 'Rect', vertexManager),
      outline,
    };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items;
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
    if (border) {
      // The fill first, which is the order canvas paints them in, with the
      // stroke taken off it so the analytic one is not drawn solid underneath.
      if (blend !== runBlend && run.length > 0) {
        flushRun();
      }
      runBlend = blend;
      const filled: SceneRectExt = { ...(item as SceneRectExt), stroke: undefined };
      run.push(filled);
      flushRun();
      enqueueOutline(
        { ...res.outline, ctx, device, bufferManager: res.bufferManager, uniformBuffer, clip },
        border,
        blend,
        strokeGradient,
        item.bounds,
      );
      continue;
    }
    if (!isGradient(fill)) {
      // a run shares one pipeline, so a change of blend starts a new one
      if (blend !== runBlend && run.length > 0) {
        flushRun();
      }
      runBlend = blend;
      run.push(item);
      // canvas composites each mark against what is already there, so two of
      // these overlapping have to meet the frame one at a time
      if (needsBackdrop(blend, ctx._opaqueBackdrop)) {
        flushRun();
      }
      continue;
    }
    flushRun();
    runBlend = blend;
    const gradientPipeline = res.gradientPipelineFor(blend);
    const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes([item as SceneRectExt], true));
    ctx._renderQueue.enqueue({
      pipeline: gradientPipeline,
      drawCounts: [6, 1],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [
        createUniformBindGroup(`${drawName}Gradient`, device, gradientPipeline, uniformBuffer),
        // rect gradients evaluate in uv space, bounds are the unit square
        createGradientBindGroup(gradientResources(), gradientPipeline, fill, [0, 0, 1, 1]),
      ],
      clip,
    });
  }
  flushRun();
}

export function rectAttributes(items: SceneItem[], whiteGradientFill = false): Float32Array {
  return Float32Array.from(
    items.flatMap(rect => {
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
      } = rect as SceneRectExt;
      const item = rect as SceneRectExt;
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
      const col =
        whiteGradientFill && isGradient(fill)
          ? whiteCarrier(opacity, fillOpacity)
          : Color.from2(fill, opacity, fillOpacity);
      const scol = Color.from2(stroke, opacity, strokeOpacity);
      // Only reserve stroke width when a stroke is actually painted. Vega marks
      // may carry a strokeWidth with no stroke (e.g. stroke set on hover only);
      // canvas ignores it, so we must too. Otherwise the transparent stroke
      // band insets the fill and the rect renders ~strokeWidth/2 px too small.
      const swidth = stroke ? (strokeWidth ?? 1) : 0;
      return [
        x,
        y,
        width,
        height,
        ...col,
        ...scol,
        swidth,
        cornerRadiusTopRight ?? cornerRadius,
        cornerRadiusBottomRight ?? cornerRadius,
        cornerRadiusBottomLeft ?? cornerRadius,
        cornerRadiusTopLeft ?? cornerRadius,
      ];
    }),
  );
}

export default {
  type: 'rect',
  draw,
} satisfies MarkModule;
