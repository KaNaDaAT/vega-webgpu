import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneImageItem, SceneImageSource } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { blendKey } from '../util/blend.js';
import { imageTexture, textureBindGroup, uploadImage, viewOf } from '../util/webgpu.js';
import { blendPipelines, getMarkResources, markItems, type MarkModule, uniformBindGroup } from './util.js';
import type WebGPURenderer from '../WebGPURenderer.js';

const drawName = 'Image';

interface TextureEntry {
  texture: GPUTexture;
  /** Keyed by sampler and blend, since each blend pipeline owns its layout. */
  bindGroups: Map<string, GPUBindGroup>;
}

interface ImageResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  /** The quad, one pipeline per blend mode. */
  pipelineFor: (blend: string) => GPURenderPipeline;
  geometryBuffer: GPUBuffer;
  smoothSampler: GPUSampler;
  pixelatedSampler: GPUSampler;
  /** Textures keyed by the loaded image/canvas object itself. */
  textures: WeakMap<object, TextureEntry>;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): ImageResources {
  return getMarkResources(ctx, 'image', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName);
    const vertexManager = new VertexBufferManager(
      ['float32x2'], // position
      ['float32x2', 'float32x2', 'float32'], // origin, size, opacity
    );
    // a blend is baked into the pipeline state, so each mode needs its own
    const pipelineFor = blendPipelines(ctx, device, `${drawName}`, drawName, vertexManager);
    const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex, true);
    const smoothSampler = device.createSampler({
      label: 'Image Sampler (smooth)',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      // an image whose width and height are scaled differently reduces by a
      // different amount on each axis, and one level for both blurs the
      // shallower one by the difference
      maxAnisotropy: 16,
    });
    // Nearest at any scale is what a 2D context does with smoothing off, so
    // this one stays on the full resolution texels however far it is reduced.
    const pixelatedSampler = device.createSampler({
      label: 'Image Sampler (pixelated)',
      magFilter: 'nearest',
      minFilter: 'nearest',
      lodMaxClamp: 0,
    });
    return {
      device,
      bufferManager,
      pipelineFor,
      geometryBuffer,
      smoothSampler,
      pixelatedSampler,
      textures: new WeakMap(),
    };
  });
}

/**
 * Mirrors vega-scenegraph's image mark: kicks off an async load through the
 * renderer (which re-renders once the image arrives) and returns whatever is
 * available right now.
 */
function getImage(item: SceneImageItem, renderer: WebGPURenderer): SceneImageSource {
  let image = item.image;
  if (!image || (item.url && item.url !== image.url)) {
    image = { complete: false, width: 0, height: 0 };
    renderer.loadImage(item.url ?? '').then(loaded => {
      item.image = loaded as SceneImageSource;
      item.image.url = item.url;
    });
  }
  return image;
}

function imageWidth(item: SceneImageItem, image: SceneImageSource): number {
  return item.width != null
    ? item.width
    : !image || !image.width
      ? 0
      : item.aspect !== false && item.height
        ? (item.height * image.width) / image.height
        : image.width;
}

function imageHeight(item: SceneImageItem, image: SceneImageSource): number {
  return item.height != null
    ? item.height
    : !image || !image.height
      ? 0
      : item.aspect !== false && item.width
        ? (item.width * image.height) / image.width
        : image.height;
}

function imageXOffset(align: SceneImageItem['align'], w: number): number {
  return align === 'center' ? w / 2 : align === 'right' ? w : 0;
}

function imageYOffset(baseline: SceneImageItem['baseline'], h: number): number {
  return baseline === 'middle' ? h / 2 : baseline === 'bottom' ? h : 0;
}

function uploadTexture(device: GPUDevice, image: SceneImageSource): GPUTexture {
  const width = image.width || 1;
  const height = image.height || 1;
  const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
  const texture = imageTexture(device, 'Image Texture', width, height, levels);

  let source: HTMLCanvasElement | ImageBitmap;
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    source = image;
  } else if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    source = image;
  } else {
    // HTMLImageElement is not a valid copy source, so go through a 2D canvas.
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return texture;
    }
    context.drawImage(image as unknown as CanvasImageSource, 0, 0);
    source = canvas;
  }

  // premultiplied, which is how canvas filters: straight alpha took a red
  // image with transparent white corners and lost its red near them
  uploadImage(device, source, texture, width, height);
  writeMipChain(device, texture, source, width, height, levels);
  return texture;
}

/**
 * Halves the image into every level below the first.
 *
 * A reduction reads four texels of whatever level it lands between, so without
 * a chain an icon drawn at a quarter of its size takes four of the sixteen
 * texels under each pixel and drops the rest. Canvas does not do that: at a
 * quarter it lands within a level of the average of all sixteen where a plain
 * bilinear read comes back empty along the edge.
 *
 * Every level is drawn from the original rather than from the one above it, so
 * each is the image reduced once through the 2D context canvas itself reduces
 * through. Halving repeatedly compounds the filter instead, which comes out
 * softer than canvas at every level past the first.
 */
function writeMipChain(
  device: GPUDevice,
  texture: GPUTexture,
  image: HTMLCanvasElement | ImageBitmap,
  width: number,
  height: number,
  levels: number,
): void {
  for (let level = 1; level < levels; level++) {
    const w = Math.max(1, width >> level);
    const h = Math.max(1, height >> level);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.imageSmoothingEnabled = true;
    context.drawImage(image, 0, 0, w, h);
    uploadImage(device, canvas, texture, w, h, [0, 0], level);
  }
}

function getBindGroup(
  res: ImageResources,
  image: SceneImageSource,
  smooth: boolean,
  pipeline: GPURenderPipeline,
  blend: string,
): GPUBindGroup {
  let entry = res.textures.get(image as object);
  if (!entry) {
    entry = { texture: uploadTexture(res.device, image), bindGroups: new Map() };
    res.textures.set(image as object, entry);
  }
  const key = `${smooth ? 'smooth' : 'pixelated'}|${blend}`;
  let bindGroup = entry.bindGroups.get(key);
  if (!bindGroup) {
    bindGroup = textureBindGroup(
      res.device,
      `Image Texture Bind Group (${key})`,
      pipeline,
      smooth ? res.smoothSampler : res.pixelatedSampler,
      viewOf(entry.texture),
    );
    entry.bindGroups.set(key, bindGroup);
  }
  return bindGroup;
}

function draw(
  this: WebGPURenderer,
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  scene: GPUVegaScene,
  vb: Bounds,
): void {
  const items = markItems<SceneImageItem>(scene);
  if (items.length === 0) {
    return;
  }

  const res = getResources(device, ctx, vb);

  const uniformBuffer = res.bufferManager.createUniformBuffer();

  for (const item of items) {
    const image = getImage(item, this);

    let w = imageWidth(item, image);
    let h = imageHeight(item, image);
    // A url that failed to load leaves a complete image carrying no pixels,
    // and drawing one of those throws rather than drawing nothing, which
    // costs the whole frame over one bad url.
    if (w === 0 || h === 0 || !image.width || !image.height || !(image.complete || image.toDataURL)) {
      continue; // not loaded yet, or never will be; the renderer re-renders on arrival
    }

    let x = (item.x || 0) - imageXOffset(item.align, w);
    let y = (item.y || 0) - imageYOffset(item.baseline, h);

    // letterbox into the given box when aspect is preserved
    if (item.aspect !== false && item.width && item.height) {
      const ar0 = image.width / image.height;
      const ar1 = item.width / item.height;
      if (ar0 === ar0 && ar1 === ar1 && ar0 !== ar1) {
        if (ar1 < ar0) {
          const t = w / ar0;
          y += (h - t) / 2;
          h = t;
        } else {
          const t = h * ar0;
          x += (w - t) / 2;
          w = t;
        }
      }
    }

    const instanceBuffer = res.bufferManager.createInstanceBuffer(Float32Array.from([x, y, w, h, item.opacity ?? 1]));
    // a pipeline with a default layout owns its bind group layout, so the
    // groups have to come from the blend variant this draw uses
    const blend = blendKey(item.blend);
    const imagePipeline = res.pipelineFor(blend);

    ctx._renderQueue.enqueue({
      pipeline: imagePipeline,
      drawCounts: [6, 1],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [
        uniformBindGroup(ctx, device, drawName, imagePipeline, uniformBuffer),
        getBindGroup(res, image, item.smooth !== false, imagePipeline, blend),
      ],
      clip: ctx._clip,
    });
  }
}

export default { draw } satisfies MarkModule;
