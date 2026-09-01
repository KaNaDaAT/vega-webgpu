import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneTextItem } from '../types/scene.js';
import { BufferManager } from '../util/bufferManager.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { quantizePhase, rasterizeText, textAnchor, textCacheKey, type TextTexture } from '../util/textTexture.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import { getMarkResources, markClip, markPipeline, type MarkModule } from './util.js';

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
  return getMarkResources(ctx, 'text', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(['float32x2', 'float32x2']); // position, uv
    const pipeline = markPipeline(ctx, device, drawName, drawName, vertexManager);
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

/**
 * Glyph texture for one label, baked at its quantized sub-pixel phase so it
 * lands where canvas draws it. Keyed by style, dpi and phase.
 */
function getTexture(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  res: TextResources,
  item: SceneTextItem,
  vb: Bounds,
): TextTexture | null {
  const dpi = ctx._uniforms.dpi || 1;
  const [ax, ay] = textAnchor(item);
  const phaseX = quantizePhase((ax - vb.x1) * dpi);
  const phaseY = quantizePhase((ay - vb.y1) * dpi);
  const key = `${textCacheKey(item)}|${dpi}|${phaseX}|${phaseY}`;
  const cached = res.cache.get(key);
  if (cached) {
    // re-insert to keep the map in least-recently-used order
    res.cache.delete(key);
    res.cache.set(key, cached);
    return cached;
  }
  const raster = rasterizeText(device, ctx, res.scratch, res.scratchCtx, item, phaseX, phaseY);
  if (!raster) {
    return null;
  }
  if (res.cache.size >= MAX_CACHE) {
    const oldest = res.cache.keys().next().value;
    if (oldest !== undefined) {
      const evicted = res.cache.get(oldest);
      res.cache.delete(oldest);
      // a queued draw may still reference it, so destroy after submit
      if (evicted) {
        ctx._renderer?.deferDestroy(evicted.texture);
      }
    }
  }
  res.cache.set(key, raster);
  return raster;
}

/**
 * Rotation and sub-pixel phase are baked into the texture, so every label is a
 * plain axis-aligned quad on a whole device pixel and maps 1:1 without
 * resampling. The shader maps (position - vb) * dpi to device pixels.
 */
function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as SceneTextItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);

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
