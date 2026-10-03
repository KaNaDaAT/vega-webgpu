/** Factory helpers for the WebGPU objects shared by all mark renderers. */
import { warnOnce } from './warn.js';

/**
 * By default rendering goes through a 4x multisampled attachment (guaranteed
 * to be supported by WebGPU) that is resolved into the canvas, so geometric
 * edges of triangulated marks get antialiased without per-shader work.
 * `wgOptions.sampleCount = 1` renders directly into the canvas instead.
 */
export const defaultSampleCount = 4;

/** WebGPU render attachments only support 1 or 4 samples portably. */
export function normalizeSampleCount(value: number): number {
  if (value === 1 || value === 4) {
    return value;
  }
  warnOnce(
    'sampleCount',
    `[vega-webgpu] Unsupported sampleCount ${value}; only 1 or 4 are supported. Using ${defaultSampleCount}.`,
  );
  return defaultSampleCount;
}

export function preferredColorFormat(): GPUTextureFormat {
  return typeof navigator !== 'undefined' && navigator.gpu ? navigator.gpu.getPreferredCanvasFormat() : 'bgra8unorm';
}

export function createRenderPipeline(
  name: string,
  device: GPUDevice,
  shader: GPUShaderModule,
  format: GPUTextureFormat,
  sampleCount: number,
  buffers: GPUVertexBufferLayout[],
  blend: GPUBlendState,
  fragmentEntryPoint = 'main_fragment',
): GPURenderPipeline {
  return device.createRenderPipeline({
    label: `${name} Render Pipeline`,
    layout: 'auto',
    vertex: {
      module: shader,
      entryPoint: 'main_vertex',
      buffers,
    },
    fragment: {
      module: shader,
      entryPoint: fragmentEntryPoint,
      targets: [{ format, blend }],
    },
    primitive: {
      topology: 'triangle-list',
    },
    multisample: {
      count: sampleCount,
    },
  });
}

/**
 * The group 0 bind group every mark pipeline takes: the shared uniform block
 * and the clip path's coverage.
 *
 * The mask is not optional. Every shader built on `uniformBlock` declares it
 * and every fragment entry reads it, so a call that left it out would build a
 * bind group short of an entry the layout has, and WebGPU throws out the whole
 * command buffer for that: the frame comes out blank and the reason goes to
 * `onuncapturederror` rather than failing anything. `clipMaskView` hands back
 * a placeholder where there is no clip, so there is always one to pass.
 */
export function createUniformBindGroup(
  name: string,
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  uniforms: GPUBuffer,
  clipMask: GPUTextureView,
): GPUBindGroup {
  return device.createBindGroup({
    label: `${name} Uniform Bind Group`,
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: uniforms,
        },
      },
      { binding: 1, resource: clipMask },
    ],
  });
}

const linearSamplers = new WeakMap<GPUDevice, GPUSampler>();

/** The bilinear, edge-clamped sampler text and gradient ramps read through. */
export function linearSampler(device: GPUDevice): GPUSampler {
  let sampler = linearSamplers.get(device);
  if (!sampler) {
    sampler = device.createSampler({
      label: 'Linear Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
    linearSamplers.set(device, sampler);
  }
  return sampler;
}

/** The group 1 bind group of a textured pipeline: its sampler and its texture. */
export function textureBindGroup(
  device: GPUDevice,
  label: string,
  pipeline: GPURenderPipeline,
  sampler: GPUSampler,
  view: GPUTextureView,
): GPUBindGroup {
  return device.createBindGroup({
    label,
    layout: pipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: view },
    ],
  });
}

/** A texture an image or a rasterized label is copied into. */
export function imageTexture(
  device: GPUDevice,
  label: string,
  width: number,
  height: number,
  mipLevelCount = 1,
): GPUTexture {
  return device.createTexture({
    label,
    size: [width, height, 1],
    mipLevelCount,
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
}

/**
 * Copies a region of a canvas or bitmap into a texture, kept premultiplied.
 * Straight alpha turns a fully transparent texel black, and filtering then
 * drags the colour next to it toward that, darkening the edge. The shaders
 * divide the alpha back out after sampling.
 */
export function uploadImage(
  device: GPUDevice,
  source: HTMLCanvasElement | ImageBitmap,
  texture: GPUTexture,
  width: number,
  height: number,
  origin: [x: number, y: number] = [0, 0],
  mipLevel = 0,
): void {
  device.queue.copyExternalImageToTexture({ source, origin }, { texture, origin, mipLevel, premultipliedAlpha: true }, [
    width,
    height,
  ]);
}
