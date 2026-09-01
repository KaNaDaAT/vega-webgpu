import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneItem, SceneRectExt } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { Color, isGradient } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import { getMarkResources, markClip, markPipeline, whiteCarrier, type MarkModule } from './util.js';

const drawName = 'Rect';

interface RectResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  gradientPipeline: GPURenderPipeline;
  geometryBuffer: GPUBuffer;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): RectResources {
  return getMarkResources(ctx, 'rect', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x2'], // position
      // center, dimensions, fill color, stroke color, stroke width, corner radii
      ['float32x2', 'float32x2', 'float32x4', 'float32x4', 'float32', 'float32x4'],
    );
    const pipeline = markPipeline(ctx, device, drawName, drawName, vertexManager);
    const gradientPipeline = markPipeline(
      ctx,
      device,
      `${drawName}Gradient`,
      drawName,
      vertexManager,
      'main_fragment_gradient',
    );
    const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex);
    return { device, bufferManager, vertexManager, pipeline, gradientPipeline, geometryBuffer };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items;
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);

  const uniformBuffer = res.bufferManager.createUniformBuffer(
    Float32Array.from([...ctx._uniforms.resolution, vb.x1, vb.y1, ctx._uniforms.dpi || 1, 0, 0, 0]),
  );
  const clip = markClip(ctx, scene);

  // only materialise the gradient sampler and ramp cache if a gradient shows up
  let gres: ReturnType<typeof getGradientResources> | null = null;
  const gradientResources = () => (gres ??= getGradientResources(device, ctx));
  let run: SceneItem[] = [];
  const flushRun = () => {
    if (run.length === 0) {
      return;
    }
    const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes(run));
    ctx._renderQueue.enqueue({
      pipeline: res.pipeline,
      drawCounts: [6, run.length],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer)],
      clip,
    });
    run = [];
  };

  for (const item of items) {
    const fill = (item as SceneRectExt).fill;
    if (!isGradient(fill)) {
      run.push(item);
      continue;
    }
    flushRun();
    const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes([item as SceneRectExt], true));
    ctx._renderQueue.enqueue({
      pipeline: res.gradientPipeline,
      drawCounts: [6, 1],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [
        createUniformBindGroup(`${drawName}Gradient`, device, res.gradientPipeline, uniformBuffer),
        // rect gradients evaluate in uv space, bounds are the unit square
        createGradientBindGroup(gradientResources(), res.gradientPipeline, fill, [0, 0, 1, 1]),
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
        x = 0,
        y = 0,
        width = 0,
        height = 0,
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
