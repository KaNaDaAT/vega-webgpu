import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { ScenePathItem } from '../types/scene.js';
import geometryForItem from '../path/geometryForItem.js';
import geometryForPath from '../path/geometryForPath.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  GeometryBatch,
  cachedGeometryData,
  type GeometryCache,
  geometryVertexData,
  getMarkResources,
  enqueueGradient,
  type GradientTarget,
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
  pipelineFor: (blend: string) => GPURenderPipeline;
  gradientPipelineFor: (blend: string) => GPURenderPipeline;
  cache: GeometryCache;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): PathResources {
  return getMarkResources(ctx, 'path', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x3', 'float32x4'], // position, color
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
    return { device, bufferManager, vertexManager, pipeline, pipelineFor, gradientPipelineFor, cache: new Map() };
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
    const [fillData, strokeData] = cachedGeometryData(res.cache, item, fill, stroke, () => {
      const shapeGeom = geometryForPath(ctx, item.path);
      // path items carry their own translation, rotation and scale
      const geometry = geometryForItem(ctx, item, shapeGeom, false, item.x || 0, item.y || 0, {
        angle: ((item.angle || 0) * Math.PI) / 180,
        scaleX: item.scaleX ?? 1,
        scaleY: item.scaleY ?? 1,
      });
      return geometryVertexData(geometry, fill, stroke);
    });

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
  type: 'path',
  draw,
} satisfies MarkModule;
