import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneImageItem, SceneImageSource } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import { getMarkResources, markClip, markPipeline, type MarkModule } from './util.js';
import type WebGPURenderer from '../WebGPURenderer.js';

const drawName = 'Image';

interface TextureEntry {
  texture: GPUTexture;
  smoothBindGroup?: GPUBindGroup;
  pixelatedBindGroup?: GPUBindGroup;
}

interface ImageResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  geometryBuffer: GPUBuffer;
  smoothSampler: GPUSampler;
  pixelatedSampler: GPUSampler;
  /** Textures keyed by the loaded image/canvas object itself. */
  textures: WeakMap<object, TextureEntry>;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): ImageResources {
  return getMarkResources(ctx, 'image', device, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x2'], // position
      ['float32x2', 'float32x2', 'float32'], // origin, size, opacity
    );
    const pipeline = markPipeline(ctx, device, drawName, drawName, vertexManager);
    const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex);
    const smoothSampler = device.createSampler({
      label: 'Image Sampler (smooth)',
      magFilter: 'linear',
      minFilter: 'linear',
    });
    const pixelatedSampler = device.createSampler({
      label: 'Image Sampler (pixelated)',
      magFilter: 'nearest',
      minFilter: 'nearest',
    });
    return {
      device,
      bufferManager,
      vertexManager,
      pipeline,
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
  const texture = device.createTexture({
    label: 'Image Texture',
    size: [width, height, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

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

  device.queue.copyExternalImageToTexture({ source }, { texture }, [width, height]);
  return texture;
}

function getBindGroup(res: ImageResources, image: SceneImageSource, smooth: boolean): GPUBindGroup {
  let entry = res.textures.get(image as object);
  if (!entry) {
    entry = { texture: uploadTexture(res.device, image) };
    res.textures.set(image as object, entry);
  }
  const key = smooth ? 'smoothBindGroup' : 'pixelatedBindGroup';
  let bindGroup = entry[key];
  if (!bindGroup) {
    bindGroup = res.device.createBindGroup({
      label: `Image Texture Bind Group (${smooth ? 'smooth' : 'pixelated'})`,
      layout: res.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: smooth ? res.smoothSampler : res.pixelatedSampler },
        { binding: 1, resource: entry.texture.createView() },
      ],
    });
    entry[key] = bindGroup;
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
  const items = scene.items as SceneImageItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  res.bufferManager.setResolution(ctx._uniforms.resolution);
  res.bufferManager.setOffset([vb.x1, vb.y1]);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const uniformBindGroup = createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer);
  const clip = markClip(ctx, scene);

  for (const item of items) {
    const image = getImage(item, this);

    let w = imageWidth(item, image);
    let h = imageHeight(item, image);
    if (w === 0 || h === 0 || !(image.complete || image.toDataURL)) {
      continue; // not loaded yet; the renderer re-renders on arrival
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

    ctx._renderQueue.enqueue({
      pipeline: res.pipeline,
      drawCounts: [6, 1],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [uniformBindGroup, getBindGroup(res, image, item.smooth !== false)],
      clip,
    });
  }
}

export default {
  type: 'image',
  draw,
} satisfies MarkModule;
