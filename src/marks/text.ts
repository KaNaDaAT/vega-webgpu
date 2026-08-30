import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneTextItem } from '../types/scene.js';
import { BufferManager } from '../util/bufferManager.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { quantizePhase, rasterizeText, textAnchor, textCacheKey, type TextTexture } from '../util/textTexture.js';
import { createRenderPipeline, createUniformBindGroup, preferredColorFormat } from '../util/webgpu.js';
import { getMarkResources, markClip, type MarkModule } from './util.js';

const drawName = 'Text';
// Bounds the per-context glyph texture cache so long interactive sessions
// (panning, zooming, streaming labels) do not leak GPU memory.
const MAX_CACHE = 1024;

interface TextResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  sampler: GPUSampler;
  scratch: HTMLCanvasElement;
  scratchCtx: CanvasRenderingContext2D;
  cache: Map<string, TextTexture>;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): TextResources {
  return getMarkResources(ctx, 'text', device, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(['float32x2', 'float32x2']); // position, uv
    const pipeline = createRenderPipeline(
      drawName,
      device,
      ctx._shaderCache[drawName],
      preferredColorFormat(),
      ctx._sampleCount,
      vertexManager.getBuffers(),
    );
    const sampler = device.createSampler({
      label: 'Text Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
    });
    const scratch = document.createElement('canvas');
    const scratchCtx = scratch.getContext('2d') as CanvasRenderingContext2D;
    return { device, bufferManager, vertexManager, pipeline, sampler, scratch, scratchCtx, cache: new Map() };
  });
}

function getTexture(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: TextResources,
  item: SceneTextItem,
  vb: Bounds,
): TextTexture | null {
  const dpi = ctx._uniforms.dpi || 1;
  const [ax, ay] = textAnchor(item);
  // Bake the glyph at its real sub-pixel phase (its fractional position on the
  // device grid the shader maps into), so the texture matches the canvas
  // renderer exactly instead of being snapped up to half a pixel away. Texture
  // pixels depend on dpi and this phase, so both are part of the cache key.
  const phaseX = quantizePhase((ax - vb.x1) * dpi);
  const phaseY = quantizePhase((ay - vb.y1) * dpi);
  const key = `${textCacheKey(item)}|${dpi}|${phaseX}|${phaseY}`;
  const cached = res.cache.get(key);
  if (cached) {
    return cached;
  }
  const raster = rasterizeText(device, ctx, res.scratch, res.scratchCtx, item, phaseX, phaseY);
  if (!raster) {
    return null;
  }
  if (res.cache.size >= MAX_CACHE) {
    const oldest = res.cache.keys().next().value;
    if (oldest !== undefined) {
      res.cache.get(oldest)?.texture.destroy();
      res.cache.delete(oldest);
    }
  }
  res.cache.set(key, raster);
  return raster;
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as SceneTextItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  res.bufferManager.setResolution(ctx._uniforms.resolution);
  res.bufferManager.setOffset([vb.x1, vb.y1]);

  const clip = markClip(ctx, scene);
  const [resX, resY] = ctx._uniforms.resolution;

  for (const item of items) {
    const opacity = item.opacity == null ? 1 : item.opacity;
    if (opacity === 0 || (item.fontSize ?? 11) <= 0 || item.text == null || String(item.text).length === 0) {
      continue;
    }

    const tex = getTexture(device, ctx, res, item, vb);
    if (!tex) {
      continue;
    }

    // Rotation and the sub-pixel phase are both baked into the glyph texture
    // (see rasterizeText), so every label, at any angle, is drawn as a plain
    // axis-aligned quad. Its origin is the anchor's device position minus where
    // the anchor sits inside the texture. The phase cancels, leaving a whole
    // device-pixel origin, so the glyph maps 1:1 to device pixels (crisp, no
    // resampling) while still landing exactly where canvas draws it. The shader
    // maps (position - vb) * dpi to device pixels, so we work in that space.
    const [ax, ay] = textAnchor(item);
    const dpi = ctx._uniforms.dpi || 1;
    const originPhysX = Math.round((ax - vb.x1) * dpi - tex.anchorTexX);
    const originPhysY = Math.round((ay - vb.y1) * dpi - tex.anchorTexY);
    const x0 = vb.x1 + originPhysX / dpi;
    const y0 = vb.y1 + originPhysY / dpi;
    const x1 = vb.x1 + (originPhysX + tex.physWidth) / dpi;
    const y1 = vb.y1 + (originPhysY + tex.physHeight) / dpi;

    // prettier-ignore
    const verts = Float32Array.from([
      x0, y0, 0, 0,  x1, y0, 1, 0,  x0, y1, 0, 1,
      x1, y0, 1, 0,  x1, y1, 1, 1,  x0, y1, 0, 1,
    ]);
    const vertexBuffer = res.bufferManager.createGeometryBuffer(verts);

    // prettier-ignore
    const uniformData = Float32Array.from([resX, resY, vb.x1, vb.y1, opacity, 0, 0, 0]);
    const uniformBuffer = res.bufferManager.createBuffer(
      `${drawName} Uniform`,
      uniformData,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const uniformBindGroup = createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer);
    const textureBindGroup = device.createBindGroup({
      label: 'Text Texture Bind Group',
      layout: res.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: res.sampler },
        { binding: 1, resource: tex.texture.createView() },
      ],
    });

    ctx._renderQueue.enqueue({
      pipeline: res.pipeline,
      drawCounts: [6, 1],
      vertexBuffers: [vertexBuffer],
      bindGroups: [uniformBindGroup, textureBindGroup],
      clip,
    });
  }
}

export default {
  type: 'text',
  draw,
} satisfies MarkModule;
