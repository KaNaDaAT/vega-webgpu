import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneAreaItem } from '../types/scene.js';
import { area } from '../path/shapes.js';
import geometryForItem from '../path/geometryForItem.js';
import { BufferManager } from '../util/bufferManager.js';
import { Color, isGradient } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createRenderPipeline, createUniformBindGroup, preferredColorFormat } from '../util/webgpu.js';
import {
  geometryVertexData,
  getMarkResources,
  gradientBounds,
  markClip,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Area';

interface AreaResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  gradientPipeline: GPURenderPipeline;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): AreaResources {
  return getMarkResources(ctx, 'area', device, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x3', 'float32x4'], // position, color
      [],
    );
    const pipeline = createRenderPipeline(
      drawName,
      device,
      ctx._shaderCache[drawName],
      preferredColorFormat(),
      ctx._sampleCount,
      vertexManager.getBuffers(),
    );
    const gradientPipeline = createRenderPipeline(
      `${drawName}Gradient`,
      device,
      ctx._shaderCache['GradientFill'],
      preferredColorFormat(),
      ctx._sampleCount,
      vertexManager.getBuffers(),
    );
    return { device, bufferManager, vertexManager, pipeline, gradientPipeline };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as SceneAreaItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  res.bufferManager.setResolution(ctx._uniforms.resolution);
  res.bufferManager.setOffset([vb.x1, vb.y1]);

  // An area mark renders all its items as one shape.
  const item = items[0];
  const bounds = scene.bounds ?? item.bounds;
  const gradient = isGradient(item.fill) && bounds ? item.fill : null;
  const fill = gradient
    ? whiteCarrier(item.opacity, item.fillOpacity)
    : Color.from2(item.fill, item.opacity, item.fillOpacity);
  const stroke = Color.from2(item.stroke, item.opacity, item.strokeOpacity);

  const shapeGeom = area(ctx, items);
  const geometry = geometryForItem(ctx, item, shapeGeom);
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
        pipeline: res.pipeline,
        drawCounts: [fillData.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
        bindGroups: [createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer)],
        clip,
      });
    }
  }

  if (strokeData.length > 0) {
    ctx._renderQueue.enqueue({
      pipeline: res.pipeline,
      drawCounts: [strokeData.length / vertexLength],
      vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
      bindGroups: [createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer)],
      clip,
    });
  }
}

export default {
  type: 'area',
  draw,
} satisfies MarkModule;
