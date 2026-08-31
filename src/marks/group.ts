import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneGroupExt } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { isGradient } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { visit } from '../util/visit.js';
import { createRenderPipeline, createUniformBindGroup, preferredColorFormat } from '../util/webgpu.js';
import { rectAttributes } from './rect.js';
import { dashedBorderInstances, getMarkResources, type MarkModule } from './util.js';
import type WebGPURenderer from '../WebGPURenderer.js';

const drawName = 'Group';

interface GroupResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  gradientPipeline: GPURenderPipeline;
  dashPipeline: GPURenderPipeline;
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
    const gradientPipeline = createRenderPipeline(
      `${drawName}Gradient`,
      device,
      ctx._shaderCache[drawName],
      preferredColorFormat(),
      ctx._sampleCount,
      vertexManager.getBuffers(),
      undefined,
      'main_fragment_gradient',
    );
    const dashVertexManager = new VertexBufferManager(
      [],
      ['float32x2', 'float32x2', 'float32x4', 'float32'], // start, end, color, width
    );
    const dashPipeline = createRenderPipeline(
      `${drawName}Dash`,
      device,
      ctx._shaderCache['SLine'],
      preferredColorFormat(),
      ctx._sampleCount,
      dashVertexManager.getBuffers(),
    );
    const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex);
    return { device, bufferManager, vertexManager, pipeline, gradientPipeline, dashPipeline, geometryBuffer };
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

  const uniformBuffer = res.bufferManager.createUniformBuffer(
    Float32Array.from([...ctx._uniforms.resolution, vb.x1, vb.y1, ctx._uniforms.dpi || 1, 0, 0, 0]),
  );
  const uniformBindGroup = createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer);

  // Group backgrounds share the rect instance layout and shader.
  const gres = getGradientResources(device, ctx);
  let run: SceneGroupExt[] = [];
  const flushRun = () => {
    if (run.length === 0) {
      return;
    }
    const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes(run));
    ctx._renderQueue.enqueue({
      pipeline: res.pipeline,
      drawCounts: [6, run.length],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [uniformBindGroup],
      clip: ctx._clip,
    });
    run = [];
  };

  const dashed: Float32Array[] = [];
  for (const item of items as SceneGroupExt[]) {
    const border = dashedBorderInstances(item);
    if (border) {
      dashed.push(border);
    }
    const drawn = border ? { ...item, stroke: undefined } : item;
    const fill = drawn.fill;
    if (!isGradient(fill)) {
      run.push(drawn);
      continue;
    }
    flushRun();
    const instanceBuffer = res.bufferManager.createInstanceBuffer(rectAttributes([drawn], true));
    ctx._renderQueue.enqueue({
      pipeline: res.gradientPipeline,
      drawCounts: [6, 1],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [
        createUniformBindGroup(`${drawName}Gradient`, device, res.gradientPipeline, uniformBuffer),
        createGradientBindGroup(gres, res.gradientPipeline, fill, [0, 0, 1, 1]),
      ],
      clip: ctx._clip,
    });
  }
  flushRun();

  for (const data of dashed) {
    ctx._renderQueue.enqueue({
      pipeline: res.dashPipeline,
      drawCounts: [6, data.length / 9],
      vertexBuffers: [res.bufferManager.createInstanceBuffer(data)],
      bindGroups: [createUniformBindGroup(`${drawName}Dash`, device, res.dashPipeline, uniformBuffer)],
      clip: ctx._clip,
    });
  }

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
