import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneGroupExt } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { visit } from '../util/visit.js';
import { createRenderPipeline, createUniformBindGroup, preferredColorFormat } from '../util/webgpu.js';
import { rectAttributes } from './rect.js';
import { getMarkResources, type MarkModule } from './util.js';
import type WebGPURenderer from '../WebGPURenderer.js';

const drawName = 'Group';

interface GroupResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  geometryBuffer: GPUBuffer;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): GroupResources {
  return getMarkResources(ctx, 'group', device, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x2'], // position
      // center, dimensions, fill color, stroke color, stroke width, corner radii
      ['float32x2', 'float32x2', 'float32x4', 'float32x4', 'float32', 'float32x4'],
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

function draw(
  this: WebGPURenderer,
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  scene: GPUVegaScene,
  vb: Bounds,
  markTypes?: string[],
): void {
  const items = scene.items;
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  res.bufferManager.setResolution(ctx._uniforms.resolution);
  res.bufferManager.setOffset([vb.x1, vb.y1]);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const uniformBindGroup = createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer);

  // Group backgrounds share the rect instance layout and shader.
  const attributes = rectAttributes(items);
  const instanceBuffer = res.bufferManager.createInstanceBuffer(attributes);

  ctx._renderQueue.enqueue({
    pipeline: res.pipeline,
    drawCounts: [6, items.length],
    vertexBuffers: [res.geometryBuffer, instanceBuffer],
    bindGroups: [uniformBindGroup],
    clip: ctx._clip,
  });

  visit(scene, (group: SceneGroupExt) => {
    const gx = group.x || 0;
    const gy = group.y || 0;
    const gw = group.width || 0;
    const gh = group.height || 0;

    // accumulate the group translation for nested marks
    ctx._tx += gx;
    ctx._ty += gy;

    const oldClip = ctx._clip;
    if (group.clip) {
      const dpi = ctx._uniforms.dpi;
      ctx._clip = [(ctx._origin[0] + ctx._tx) * dpi, (ctx._origin[1] + ctx._ty) * dpi, gw * dpi, gh * dpi];
    }
    if (vb) {
      vb.translate(-gx, -gy);
    }

    visit(group, (item: GPUVegaScene) => {
      if (item.marktype === 'group' || markTypes == null || markTypes.includes(item.marktype)) {
        this.draw(device, ctx, item, vb, markTypes);
      }
    });

    if (vb) {
      vb.translate(gx, gy);
    }
    if (group.clip) {
      ctx._clip = oldClip;
    }
    ctx._tx -= gx;
    ctx._ty -= gy;
  });
}

export default {
  type: 'group',
  draw,
} satisfies MarkModule;
