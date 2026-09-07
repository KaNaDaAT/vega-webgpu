import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneAreaItem } from '../types/scene.js';
import { trail } from '../path/shapes.js';
import geometryForItem from '../path/geometryForItem.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  geometryVertexData,
  getMarkResources,
  gradientBounds,
  markClip,
  markPipeline,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Trail';

interface TrailResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  pipelineFor: (blend: string) => GPURenderPipeline;
  gradientPipeline: GPURenderPipeline;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): TrailResources {
  return getMarkResources(ctx, 'trail', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x3', 'float32x4'], // position, color
      [],
    );
    // a trail is a filled path, so it shares the area shader
    const pipeline = markPipeline(ctx, device, drawName, 'Area', vertexManager);
    // blend needs its own pipeline, and markPipeline caches them by mode
    const pipelineFor = (blend: string) =>
      blend === 'normal'
        ? pipeline
        : markPipeline(ctx, device, `${drawName} ${blend}`, 'Area', vertexManager, undefined, blend);
    const gradientPipeline = markPipeline(ctx, device, `${drawName}Gradient`, 'GradientFill', vertexManager);
    return { device, bufferManager, vertexManager, pipeline, pipelineFor, gradientPipeline };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as SceneAreaItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);

  // A trail mark renders all its items as one ribbon.
  const item = items[0];
  const pipeline = res.pipelineFor(blendKey(item.blend));
  const bounds = scene.bounds ?? item.bounds;
  const gradient = isGradient(item.fill) && bounds ? item.fill : null;
  const fill = gradient
    ? whiteCarrier(item.opacity, item.fillOpacity)
    : Color.from2(item.fill, item.opacity, item.fillOpacity);
  const stroke = Color.from2(item.stroke, item.opacity, item.strokeOpacity);

  const shapeGeom = trail(ctx, items);
  const geometry = geometryForItem(ctx, item, shapeGeom, true);
  const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const clip = markClip(ctx, scene);
  const vertexLength = res.vertexManager.getVertexLength();

  if (fillData.length > 0) {
    if (gradient && bounds) {
      const gres = getGradientResources(device, ctx);
      ctx._renderQueue.enqueue({
        pipeline: res.gradientPipeline,
        drawCounts: [fillData.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
        bindGroups: [
          createUniformBindGroup(`${drawName}Gradient`, device, res.gradientPipeline, uniformBuffer),
          createGradientBindGroup(gres, res.gradientPipeline, gradient, gradientBounds(ctx, bounds)),
        ],
        clip,
      });
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
    ctx._renderQueue.enqueue({
      pipeline,
      drawCounts: [strokeData.length / vertexLength],
      vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
      bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer)],
      clip,
    });
  }
}

export default {
  type: 'trail',
  draw,
} satisfies MarkModule;
