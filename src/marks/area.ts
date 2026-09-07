import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneAreaItem } from '../types/scene.js';
import { area } from '../path/shapes.js';
import geometryForItem from '../path/geometryForItem.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  geometryVertexData,
  getMarkResources,
  enqueueGradient,
  type GradientTarget,
  markClip,
  markPipeline,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Area';

interface AreaResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  pipelineFor: (blend: string) => GPURenderPipeline;
  gradientPipelineFor: (blend: string) => GPURenderPipeline;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): AreaResources {
  return getMarkResources(ctx, 'area', device, vb, () => {
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
  const items = scene.items as SceneAreaItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);

  // An area mark renders all its items as one shape.
  const item = items[0];
  const pipeline = res.pipelineFor(blendKey(item.blend));
  const bounds = scene.bounds ?? item.bounds;
  const gradient = isGradient(item.fill) && bounds ? item.fill : null;
  const fill = gradient
    ? whiteCarrier(item.opacity, item.fillOpacity)
    : Color.from2(item.fill, item.opacity, item.fillOpacity);
  const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
  const stroke = strokeGradient
    ? whiteCarrier(item.opacity, item.strokeOpacity)
    : Color.from2(item.stroke, item.opacity, item.strokeOpacity);

  const shapeGeom = area(ctx, items);
  const geometry = geometryForItem(ctx, item, shapeGeom, true);
  const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);

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

  if (fillData.length > 0) {
    if (gradient && bounds) {
      enqueueGradient(gradientTarget, fillData, gradient, bounds, blendKey(item.blend));
    } else {
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [fillData.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
        bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer)],
        clip,
      });
    }
  }

  if (strokeData.length > 0) {
    if (strokeGradient && bounds) {
      enqueueGradient(gradientTarget, strokeData, strokeGradient, bounds, blendKey(item.blend));
    } else {
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [strokeData.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
        bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer)],
        clip,
      });
    }
  }
}

export default {
  type: 'area',
  draw,
} satisfies MarkModule;
