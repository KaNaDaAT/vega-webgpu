/** Factory helpers for the WebGPU objects shared by all mark renderers. */

/**
 * By default rendering goes through a 4x multisampled attachment (guaranteed
 * to be supported by WebGPU) that is resolved into the canvas, so geometric
 * edges of triangulated marks get antialiased without per-shader work.
 * `wgOptions.sampleCount = 1` renders directly into the canvas instead.
 */
export const defaultSampleCount = 4;

let warnedSampleCount = false;

/** WebGPU render attachments only support 1 or 4 samples portably. */
export function normalizeSampleCount(value: number): number {
  if (value === 1 || value === 4) {
    return value;
  }
  if (!warnedSampleCount) {
    warnedSampleCount = true;
    console.warn(
      `[vega-webgpu] Unsupported sampleCount ${value}; only 1 or 4 are supported. Using ${defaultSampleCount}.`,
    );
  }
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

