import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneItem, SceneRule } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { Color } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createRenderPipeline, createUniformBindGroup, preferredColorFormat } from '../util/webgpu.js';
import { getMarkResources, markClip, type MarkModule } from './util.js';

const drawName = 'Rule';

interface RuleResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  geometryBuffer: GPUBuffer;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): RuleResources {
  return getMarkResources(ctx, 'rule', device, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x2'], // position
      ['float32x2', 'float32x2', 'float32x4'], // center, scale, color
    );
    const pipeline = createRenderPipeline(
      drawName,
      device,
      ctx._shaderCache[drawName],
      preferredColorFormat(),
      ctx._sampleCount,
      vertexManager.getBuffers(),
    );
    const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex);
    return { device, bufferManager, vertexManager, pipeline, geometryBuffer };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items;
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  res.bufferManager.setResolution(ctx._uniforms.resolution);
  res.bufferManager.setOffset([vb.x1, vb.y1]);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const uniformBindGroup = createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer);

  const attributes = createAttributes(items);
  const instanceBuffer = res.bufferManager.createInstanceBuffer(attributes);

  ctx._renderQueue.enqueue({
    pipeline: res.pipeline,
    drawCounts: [6, items.length],
    vertexBuffers: [res.geometryBuffer, instanceBuffer],
    bindGroups: [uniformBindGroup],
    clip: markClip(ctx, scene),
  });
}

function createAttributes(items: SceneItem[]): Float32Array {
  return Float32Array.from(
    items.flatMap(item => {
      const { x = 0, y = 0, x2, y2, stroke, strokeWidth = 1, opacity = 1, strokeOpacity = 1 } = item as SceneRule;
      const ex = x2 ?? x;
      const ey = y2 ?? y;
      const ax = Math.abs(ex - x);
      const ay = Math.abs(ey - y);
      const col = Color.from(stroke, opacity, strokeOpacity);
      return [Math.min(x, ex), Math.min(y, ey), ax ? ax : strokeWidth, ay ? ay : strokeWidth, ...col.rgba];
    }),
  );
}

export default {
  type: 'rule',
  draw,
} satisfies MarkModule;
