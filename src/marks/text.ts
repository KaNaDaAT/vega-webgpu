import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneTextItem } from '../types/scene.js';
import { BufferManager } from '../util/bufferManager.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { TextAtlas, type GlyphSlot } from '../util/textAtlas.js';
import {
  NO_TURN,
  drawGlyph,
  glyphMetrics,
  rasterizeText,
  textAnchor,
  textCacheKey,
  turnOf,
  upright,
  type GlyphMetrics,
  type Turn,
} from '../util/textTexture.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import { getMarkResources, markClip, markPipeline, type MarkModule } from './util.js';

const drawName = 'Text';

/** Per instance: quad rect, atlas sub-rect, anchor with cos and sin, opacity. */
const LABEL_LAYOUT: GPUVertexFormat[] = ['float32x4', 'float32x4', 'float32x4', 'float32'];
const LABEL_STRIDE = 13;

/**
 * Upload time above which a mark stops rasterizing the rotation into its
 * labels. A rotated label costs roughly 0.15 ms, all of it inside the atlas
 * upload rather than at the call that asked for it, so the choice is made for a
 * whole draw from what the last one cost. Half a frame of crisp labels and half
 * of turned ones would be worse than either.
 */
const UPLOAD_BUDGET_MS = 2.5;

interface TextResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  sampler: GPUSampler;
  atlas: TextAtlas;
  /** Whether a rotated label is still worth rasterizing at its angle. */
  exact: boolean;
  /** Scratch for a label too large to pack. */
  scratch: HTMLCanvasElement;
  scratchCtx: CanvasRenderingContext2D;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): TextResources {
  return getMarkResources(ctx, 'text', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager([], LABEL_LAYOUT);
    const pipeline = markPipeline(ctx, device, drawName, drawName, vertexManager);
    const sampler = device.createSampler({
      label: 'Text Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
    });
    const atlas = new TextAtlas(device);
    atlas.onRelease = texture => ctx._renderer?.deferDestroy(texture);
    const scratch = document.createElement('canvas');
    const scratchCtx = scratch.getContext('2d') as CanvasRenderingContext2D;
    return {
      device,
      bufferManager,
      vertexManager,
      pipeline,
      sampler,
      atlas,
      exact: true,
      scratch,
      scratchCtx,
    };
  });
}

/** A label's place in the atlas, and the turn its quad still has to apply. */
interface Placement {
  slot: GlyphSlot;
  turn: Turn;
}



/**
 * Slot for one rasterization of a label. On a miss it draws the label into the
 * atlas, unless `rasterize` is false, which asks only whether it is already
 * there.
 */
function getSlot(
  ctx: GPUVegaCanvasContext,
  res: TextResources,
  raster: SceneTextItem,
  vb: Bounds,
  turn: Turn,
  rasterize: boolean,
): GlyphSlot | null {
  const dpi = ctx._uniforms.dpi || 1;
  const metrics = glyphMetrics(ctx, raster, vb, turn);
  if (!metrics) {
    return null;
  }
  const key = `${textCacheKey(raster)}|${dpi}|${metrics.anchorTexX}|${metrics.anchorTexY}`;

  const cached = res.atlas.find(key);
  if (cached) {
    return cached;
  }
  if (!rasterize) {
    return null;
  }
  const slot = res.atlas.alloc(key, metrics);
  if (!slot) {
    return null;
  }
  drawGlyph(res.atlas.context, dpi, raster, metrics, slot.x, slot.y);
  return slot;
}

/**
 * Places a label, preferring the rasterization with the rotation baked in and
 * falling back to an upright one the quad turns when this draw is not
 * rasterizing rotations.
 */
function place(
  ctx: GPUVegaCanvasContext,
  res: TextResources,
  item: SceneTextItem,
  vb: Bounds,
  turn: Turn,
  exact: boolean,
): Placement | null {
  if (turn === NO_TURN || exact) {
    const slot = getSlot(ctx, res, item, vb, NO_TURN, true);
    return slot && { slot, turn: NO_TURN };
  }
  const cached = getSlot(ctx, res, item, vb, NO_TURN, false);
  if (cached) {
    return { slot: cached, turn: NO_TURN };
  }
  const slot = getSlot(ctx, res, upright(item), vb, turn, true);
  return slot && { slot, turn };
}

/**
 * Places one label's quad, in logical pixels. The offsets are not rounded here:
 * glyphMetrics already chose the anchor offset that lands the turned corner on
 * a whole device pixel.
 */
function labelRect(vb: Bounds, dpi: number, item: SceneTextItem, m: GlyphMetrics): [number, number, number, number] {
  const [ax, ay] = textAnchor(item);
  const originPhysX = (ax - vb.x1) * dpi - m.anchorTexX;
  const originPhysY = (ay - vb.y1) * dpi - m.anchorTexY;
  return [
    vb.x1 + originPhysX / dpi,
    vb.y1 + originPhysY / dpi,
    vb.x1 + (originPhysX + m.physWidth) / dpi,
    vb.y1 + (originPhysY + m.physHeight) / dpi,
  ];
}

/**
 * Rotation and sub-pixel phase are baked into the atlas, so every label is a
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
  const dpi = ctx._uniforms.dpi || 1;

  // Atlas coordinates stay in pixels until the batch closes: the first
  // allocation may grow the atlas, and every slot in a batch shares its size.
  const settling = ctx._renderer?.settling === true;
  const exact = settling || res.exact;
  let deferred = false;
  res.atlas.begin();
  // Atlas coordinates stay in pixels until the batch closes, since begin may
  // have resized it and every slot in a batch shares one size.
  const packed: number[] = [];
  const oversized: { texture: GPUTexture; data: Float32Array }[] = [];

  for (const item of items) {
    const opacity = item.opacity == null ? 1 : item.opacity;
    if (opacity === 0 || (item.fontSize ?? 11) <= 0 || item.text == null || String(item.text).length === 0) {
      continue;
    }

    const [ax, ay] = textAnchor(item);
    const turn = turnOf(item);

    const placed = place(ctx, res, item, vb, turn, exact);
    deferred ||= placed !== null && placed.turn !== NO_TURN;
    if (placed) {
      const { slot } = placed;
      const [x1, y1, x2, y2] = labelRect(vb, dpi, item, slot);
      packed.push(
        x1,
        y1,
        x2,
        y2,
        slot.x,
        slot.y,
        slot.x + slot.physWidth,
        slot.y + slot.physHeight,
        ax,
        ay,
        placed.turn[0],
        placed.turn[1],
        opacity,
      );
      continue;
    }

    const metrics = glyphMetrics(ctx, item, vb, NO_TURN);
    if (!metrics) {
      continue;
    }
    const tex = rasterizeText(device, res.scratch, res.scratchCtx, dpi, item, metrics);
    ctx._renderer?.deferDestroy(tex.texture);
    const [x1, y1, x2, y2] = labelRect(vb, dpi, item, metrics);
    oversized.push({
      texture: tex.texture,
      data: Float32Array.from([x1, y1, x2, y2, 0, 0, 1, 1, ax, ay, 1, 0, opacity]),
    });
  }

  const t0 = performance.now();
  res.atlas.flush();
  if (!settling && performance.now() - t0 > UPLOAD_BUDGET_MS) {
    res.exact = false;
  }
  if (deferred) {
    ctx._renderer?.requestSettle();
  }

  const size = res.atlas.size;
  for (let i = 0; i < packed.length; i += LABEL_STRIDE) {
    packed[i + 4] /= size;
    packed[i + 5] /= size;
    packed[i + 6] /= size;
    packed[i + 7] /= size;
  }

  const uniformBuffer = res.bufferManager.sharedUniformBuffer();
  const uniformBindGroup = createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer);

  const enqueue = (texture: GPUTexture, data: Float32Array) => {
    ctx._renderQueue.enqueue({
      pipeline: res.pipeline,
      drawCounts: [6, data.length / LABEL_STRIDE],
      vertexBuffers: [res.bufferManager.createInstanceBuffer(data)],
      bindGroups: [
        uniformBindGroup,
        device.createBindGroup({
          label: 'Text Texture Bind Group',
          layout: res.pipeline.getBindGroupLayout(1),
          entries: [
            { binding: 0, resource: res.sampler },
            { binding: 1, resource: texture.createView() },
          ],
        }),
      ],
      clip,
    });
  };

  if (packed.length > 0) {
    enqueue(res.atlas.texture, Float32Array.from(packed));
  }
  for (const extra of oversized) {
    enqueue(extra.texture, extra.data);
  }
}

export default {
  type: 'text',
  draw,
} satisfies MarkModule;
