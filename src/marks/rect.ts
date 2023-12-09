import { color } from 'd3-color';
import { Bounds } from 'vega-scenegraph';
import {
  SceneGroup,
  SceneRect,
} from 'vega-typings';
import shaderSource from '../shaders/rect.wgsl';
import { quadVertex } from '../util/arrays';

interface WebGPUSceneGroup extends SceneGroup {
  _pipeline?: GPURenderPipeline;
  _geometryBuffer?: GPUBuffer; // geometry to be instanced
  _instanceBuffer?: GPUBuffer; // attributes for each instance
  _uniformsBuffer?: GPUBuffer;
  _frameBuffer?: GPUBuffer; // writebuffer to be used for each frame
  _uniformsBindGroup?: GPUBindGroup;
  _format: GPUTextureFormat;
}

function initRenderPipeline(device: GPUDevice, scene: WebGPUSceneGroup) {
  const shader = device.createShaderModule({ code: shaderSource, label: 'Rect Shader' });
  scene._pipeline = device.createRenderPipeline({
    label: 'Rect Render Pipeline',
    layout: "auto" as unknown as GPUPipelineLayout,
    vertex: {
      module: shader,
      entryPoint: 'main_vertex',
      buffers: [  
        {
          arrayStride: Float32Array.BYTES_PER_ELEMENT * 2,
          stepMode: 'vertex',
          attributes: [
            // position
            {
              shaderLocation: 0,
              offset: 0,
              format: 'float32x2',
            },
          ],
        },
        {
          arrayStride: Float32Array.BYTES_PER_ELEMENT * 13,
          stepMode: 'instance',
          attributes: [
            // center
            {
              shaderLocation: 1,
              offset: 0,
              format: 'float32x2',
            },
            // dimensions
            {
              shaderLocation: 2,
              offset: Float32Array.BYTES_PER_ELEMENT * 2,
              format: 'float32x2',
            },
            // fill color
            {
              shaderLocation: 3,
              offset: Float32Array.BYTES_PER_ELEMENT * 4,
              format: 'float32x4',
            },
            // stroke color
            {
              shaderLocation: 4,
              offset: Float32Array.BYTES_PER_ELEMENT * 8,
              format: 'float32x4',
            },
            // stroke width
            {
              shaderLocation: 5,
              offset: Float32Array.BYTES_PER_ELEMENT * 12,
              format: 'float32',
            },
          ],
        },
      ] as Iterable<GPUVertexBufferLayout | null>,
    },
    fragment: {
      module: shader,
      entryPoint: 'main_fragment',
      targets: [
        {
          format: scene._format,
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
          } as GPUBlendState,
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
    depthStencil: {
      format: 'depth24plus',
      depthCompare: 'less',
      depthWriteEnabled: true,
    },
  });

  scene._geometryBuffer = device.createBuffer({
    label: 'Rect Geometry Buffer',
    size: quadVertex.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });

  const geometryData = new Float32Array(scene._geometryBuffer.getMappedRange());
  geometryData.set(quadVertex);
  scene._geometryBuffer.unmap();

  scene._uniformsBuffer = device.createBuffer({
    label: 'Rect Uniform Buffer',
    size: Float32Array.BYTES_PER_ELEMENT * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });

  scene._uniformsBindGroup = device.createBindGroup({
    label: 'Rect Uniform Bind Group',
    layout: scene._pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: scene._uniformsBuffer,
        },
      },
    ],
  });

  scene._instanceBuffer = device.createBuffer({
    // 13 for number of attributes
    label: 'Rect Instance Buffer',
    size: scene.items.length * 13 * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  scene._instanceBuffer.unmap();

  scene._frameBuffer = device.createBuffer({
    label: 'Rect Frame Buffer',
    size: scene.items.length * 13 * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
    mappedAtCreation: true,
  });
  scene._frameBuffer.unmap();
}

function draw(device: GPUDevice, ctx: GPUCanvasContext, scene: WebGPUSceneGroup, vb: Bounds): [] {
  if (!scene.items?.length) {
    return;
  }

  if (!this._pipeline) {
    scene._format = this.prefferedFormat();
    initRenderPipeline(device, scene);
    const uniformsData = new Float32Array(scene._uniformsBuffer.getMappedRange());
    const resolution = this._uniforms.resolution;
    const uniforms = Float32Array.from([...resolution, vb.x1, vb.y1]);
    uniformsData.set(uniforms);
    scene._uniformsBuffer.unmap();
  }

  const attributes = Float32Array.from(
    scene.items.flatMap((item: SceneRect) => {
      const {
        x = 0,
        y = 0,
        width = 0,
        height = 0,
        fill,
        //@ts-ignore
        fillOpacity = 1,
        //@ts-ignore
        stroke,
        //@ts-ignore
        strokeOpacity = 1,
        //@ts-ignore
        strokeWidth = 1,
      } = item;
      const fillCol = color(fill).rgb();
      const strokeCol = color(stroke)?.rgb();
      const stropacity = strokeCol ? strokeOpacity : 0;
      const strcol = strokeCol ? strokeCol : { r: 0, g: 0, b: 0 };
      return [
        x,
        y,
        width,
        height,
        fillCol.r / 255,
        fillCol.g / 255,
        fillCol.b / 255,
        fillOpacity,
        strcol.r / 255,
        strcol.g / 255,
        strcol.b / 255,
        stropacity,
        strokeWidth,
      ];
    }),
  );

  const pipeline = scene._pipeline;
  const frameBuffer = scene._frameBuffer;
  const instanceBuffer = scene._instanceBuffer;
  const geometryBuffer = scene._geometryBuffer;
  const uniformsBindGroup = scene._uniformsBindGroup;
  const items = scene.items;
  (async () => {
    await frameBuffer.mapAsync(GPUMapMode.WRITE).then(() => {
      const frameData = new Float32Array(frameBuffer.getMappedRange());
      frameData.set(attributes);

      const copyEncoder = device.createCommandEncoder();
      copyEncoder.copyBufferToBuffer(
        frameBuffer,
        frameData.byteOffset,
        instanceBuffer,
        attributes.byteOffset,
        attributes.byteLength,
      );

      const commandEncoder = device.createCommandEncoder();
      const depthTexture = this.depthTexture();
      const renderPassDescriptor: GPURenderPassDescriptor = {
        label: 'Rect Render Pass Descriptor',
        colorAttachments: [
          {
            view: undefined, // Assigned later
            clearValue: this.clearColor(),
            loadOp: 'clear',
            storeOp: 'store',
          } as GPURenderPassColorAttachment,
        ],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      };
      renderPassDescriptor.colorAttachments[0].view = ctx.getCurrentTexture().createView();

      const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
      passEncoder.setPipeline(pipeline);
      passEncoder.setVertexBuffer(0, geometryBuffer);
      passEncoder.setVertexBuffer(1, instanceBuffer);
      passEncoder.setBindGroup(0, uniformsBindGroup);
      // 6 because we are drawing two triangles
      passEncoder.draw(6, items.length);
      passEncoder.end();
      frameBuffer.unmap();
      device.queue.submit([copyEncoder.finish(), commandEncoder.finish()]);
    })
  })();
}

export default {
  type: 'rect',
  draw: draw,
};
