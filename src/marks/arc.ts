import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneArcItem } from '../types/scene.js';
import { arc } from '../path/shapes.js';
import geometryForItem from '../path/geometryForItem.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  GeometryBatch,
  geometryVertexData,
  getMarkResources,
  enqueueGradient,
  type GradientTarget,
  markClip,
  markPipeline,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Arc';

interface ArcResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  /** Arc geometry is translated to world space and shares the path shader. */
  pipeline: GPURenderPipeline;
  pipelineFor: (blend: string) => GPURenderPipeline;
  gradientPipelineFor: (blend: string) => GPURenderPipeline;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): ArcResources {
  return getMarkResources(ctx, 'arc', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x3', 'float32x4'], // position, color
      [],
    );
    const pipeline = markPipeline(ctx, device, drawName, 'SolidFill', vertexManager);
    // blend needs its own pipeline, and markPipeline caches them by mode
    const pipelineFor = (blend: string) =>
      blend === 'normal'
        ? pipeline
        : markPipeline(ctx, device, `${drawName} ${blend}`, 'SolidFill', vertexManager, undefined, blend);
    const gradientPipeline = markPipeline(ctx, device, `${drawName}Gradient`, 'GradientFill', vertexManager);
    // a gradient fill under a blend needs its own pipeline too
    const gradientPipelineFor = (blend: string) =>
      blend === 'normal'
        ? gradientPipeline
        : markPipeline(ctx, device, `${drawName}Gradient ${blend}`, 'GradientFill', vertexManager, undefined, blend);
    return { device, bufferManager, vertexManager, pipeline, pipelineFor, gradientPipelineFor };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as SceneArcItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const clip = markClip(ctx, scene);
  const vertexLength = res.vertexManager.getVertexLength();
  const gradientTarget: GradientTarget = {
    ctx,
    device,
    name: `${drawName}Gradient`,
    pipelineFor: res.gradientPipelineFor,
    bufferManager: res.bufferManager,
    uniformBuffer,
    vertexLength,
    clip,
  };

  // Solid fills and strokes share one pipeline and are accumulated in paint
  // order into a single buffer/draw. Gradient fills interrupt the batch.
  const batch = new GeometryBatch();
  // one batch draws with one pipeline, so a change of blend closes it
  let batchBlend = 'normal';
  const flushBatch = () => {
    const data = batch.flush();
    if (data) {
      const pipeline = res.pipelineFor(batchBlend);
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [data.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(data)],
        bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer)],
        clip,
      });
    }
  };

  for (const item of items) {
    const blend = blendKey(item.blend);
    if (blend !== batchBlend) {
      flushBatch();
      batchBlend = blend;
    }
    const bounds = item.bounds;
    const gradient = isGradient(item.fill) && bounds ? item.fill : null;
    const fill = gradient
      ? whiteCarrier(item.opacity, item.fillOpacity)
      : Color.from2(item.fill, item.opacity, item.fillOpacity);
    const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
    const stroke = strokeGradient
      ? whiteCarrier(item.opacity, item.strokeOpacity)
      : Color.from2(item.stroke, item.opacity, item.strokeOpacity);

    const shapeGeom = arc(ctx, item);
    // arc paths are generated around the origin, so bake the item center in
    const geometry = geometryForItem(ctx, item, shapeGeom, false, item.x || 0, item.y || 0);
    const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);

    if (fillData.length > 0 && gradient && bounds) {
      flushBatch();
      enqueueGradient(gradientTarget, fillData, gradient, bounds, blendKey(item.blend));
    } else {
      batch.push(fillData);
    }
    if (strokeData.length > 0 && strokeGradient && bounds) {
      flushBatch();
      enqueueGradient(gradientTarget, strokeData, strokeGradient, bounds, blendKey(item.blend));
    } else {
      batch.push(strokeData);
    }
  }
  flushBatch();
}

export default {
  type: 'arc',
  draw,
} satisfies MarkModule;
