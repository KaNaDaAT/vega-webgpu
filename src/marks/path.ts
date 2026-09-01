import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { ScenePathItem } from '../types/scene.js';
import geometryForItem from '../path/geometryForItem.js';
import geometryForPath from '../path/geometryForPath.js';
import { BufferManager } from '../util/bufferManager.js';
import { Color, isGradient } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  GeometryBatch,
  geometryVertexData,
  getMarkResources,
  gradientBounds,
  markClip,
  markPipeline,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Path';

interface PathResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  gradientPipeline: GPURenderPipeline;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): PathResources {
  return getMarkResources(ctx, 'path', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x3', 'float32x4'], // position, color
    );
    const pipeline = markPipeline(ctx, device, drawName, drawName, vertexManager);
    const gradientPipeline = markPipeline(ctx, device, `${drawName}Gradient`, 'GradientFill', vertexManager);
    return { device, bufferManager, vertexManager, pipeline, gradientPipeline };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as ScenePathItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const clip = markClip(ctx, scene);
  const vertexLength = res.vertexManager.getVertexLength();

  // Solid fills and strokes share one pipeline and are accumulated in paint
  // order into a single buffer/draw. Gradient fills interrupt the batch.
  const batch = new GeometryBatch();
  const flushBatch = () => {
    const data = batch.flush();
    if (data) {
      ctx._renderQueue.enqueue({
        pipeline: res.pipeline,
        drawCounts: [data.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(data)],
        bindGroups: [createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer)],
        clip,
      });
    }
  };

  for (const item of items) {
    const bounds = item.bounds;
    const gradient = isGradient(item.fill) && bounds ? item.fill : null;
    const gBounds = gradient && bounds ? gradientBounds(ctx, bounds) : null;

    const shapeGeom = geometryForPath(ctx, item.path);
    // path items carry their own x/y translation (matching the canvas mark)
    const geometry = geometryForItem(ctx, item, shapeGeom, false, item.x || 0, item.y || 0);
    const fill = gradient
      ? whiteCarrier(item.opacity, item.fillOpacity)
      : Color.from2(item.fill, item.opacity, item.fillOpacity);
    const stroke = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
    const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);

    if (fillData.length > 0 && gradient && gBounds) {
      flushBatch();
      const gres = getGradientResources(device, ctx);
      ctx._renderQueue.enqueue({
        pipeline: res.gradientPipeline,
        drawCounts: [fillData.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
        bindGroups: [
          createUniformBindGroup(`${drawName}Gradient`, device, res.gradientPipeline, uniformBuffer),
          createGradientBindGroup(gres, res.gradientPipeline, gradient, gBounds),
        ],
        clip,
      });
    } else {
      batch.push(fillData);
    }
    batch.push(strokeData);
  }
  flushBatch();
}

export default {
  type: 'path',
  draw,
} satisfies MarkModule;
