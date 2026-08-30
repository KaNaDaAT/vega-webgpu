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
  layout?: GPUPipelineLayout,
  fragmentEntryPoint = 'main_fragment',
): GPURenderPipeline {
  return device.createRenderPipeline({
    label: `${name} Render Pipeline`,
    layout: layout ?? 'auto',
    vertex: {
      module: shader,
      entryPoint: 'main_vertex',
      buffers,
    },
    fragment: {
      module: shader,
      entryPoint: fragmentEntryPoint,
      targets: [
        {
          format,
          blend: {
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
    multisample: {
      count: normalizeSampleCount(sampleCount),
    },
  });
}

export function createUniformBindGroup(
  name: string,
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  uniforms: GPUBuffer,
  binding = 0,
): GPUBindGroup {
  return device.createBindGroup({
    label: `${name} Uniform Bind Group`,
    layout: pipeline.getBindGroupLayout(binding),
    entries: [
      {
        binding,
        resource: {
          buffer: uniforms,
        },
      },
    ],
  });
}

/**
 * The frame renders in a single pass: the color attachment is cleared to the
 * view background on load, drawn in scenegraph order (painter's algorithm,
 * there is no depth attachment), and resolved once when multisampled.
 */
export function createRenderPassDescriptor(
  name: string,
  clearColor: GPUColor,
): GPURenderPassDescriptor & { colorAttachments: GPURenderPassColorAttachment[] } {
  return {
    label: `${name} Render Pass Descriptor`,
    colorAttachments: [
      {
        // Views are assigned by the renderer before submission.
        view: undefined as unknown as GPUTextureView,
        resolveTarget: undefined,
        clearValue: clearColor,
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  };
}
