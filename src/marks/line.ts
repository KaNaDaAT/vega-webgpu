import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneLinePoint } from '../types/scene.js';
import { BufferManager } from '../util/bufferManager.js';
import { Color } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createRenderPipeline, createUniformBindGroup, preferredColorFormat } from '../util/webgpu.js';
import { getMarkResources, markClip, type MarkModule } from './util.js';

const drawName = 'Line';
// Round joins are drawn as filled circles at interior vertices.
const JOIN_SEGMENTS = 24;

interface LineResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  /** Per-instance resolution/offset; batches across marks with different offsets. */
  batchVertexManager: VertexBufferManager;
  /** Resolution/offset from the uniform buffer; one instanced draw per mark. */
  instancedVertexManager: VertexBufferManager;
  batchPipeline: GPURenderPipeline;
  instancedPipeline: GPURenderPipeline;
  /** Round-join pipeline (reuses the antialiased symbol-circle shader). */
  joinPipeline: GPURenderPipeline;
  joinVertexManager: VertexBufferManager;
  joinGeometryBuffer: GPUBuffer;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): LineResources {
  return getMarkResources(ctx, 'line', device, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const batchVertexManager = new VertexBufferManager(
      [],
      ['float32x2', 'float32x2', 'float32x4', 'float32', 'float32x2', 'float32x2'], // start, end, color, width, res, offset
    );
    const instancedVertexManager = new VertexBufferManager(
      [],
      ['float32x2', 'float32x2', 'float32x4', 'float32'], // start, end, color, width
    );
    const batchPipeline = createRenderPipeline(
      drawName,
      device,
      ctx._shaderCache['Line'],
      preferredColorFormat(),
      ctx._sampleCount,
      batchVertexManager.getBuffers(),
    );
    const instancedPipeline = createRenderPipeline(
      `S${drawName}`,
      device,
      ctx._shaderCache['SLine'],
      preferredColorFormat(),
      ctx._sampleCount,
      instancedVertexManager.getBuffers(),
    );
    const joinVertexManager = new VertexBufferManager(
      ['float32x2'], // position (unit circle)
      // center, radius, fill color, stroke color, stroke width (symbol layout)
      ['float32x2', 'float32', 'float32x4', 'float32x4', 'float32'],
    );
    const joinPipeline = createRenderPipeline(
      `${drawName}Join`,
      device,
      ctx._shaderCache['Symbol'],
      preferredColorFormat(),
      ctx._sampleCount,
      joinVertexManager.getBuffers(),
    );
    const joinGeometryBuffer = bufferManager.createGeometryBuffer(createJoinGeometry());
    return {
      device,
      bufferManager,
      batchVertexManager,
      instancedVertexManager,
      batchPipeline,
      instancedPipeline,
      joinPipeline,
      joinVertexManager,
      joinGeometryBuffer,
    };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items;
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  res.bufferManager.setResolution(ctx._uniforms.resolution);
  res.bufferManager.setOffset([vb.x1, vb.y1]);
  const clip = markClip(ctx, scene);
  const points = items as SceneLinePoint[];

  if (ctx._renderer.wgOptions.renderBatch === true) {
    // One instanced draw per line mark.
    const uniformBindGroup = createUniformBindGroup(
      `S${drawName}`,
      device,
      res.instancedPipeline,
      res.bufferManager.createUniformBuffer(),
    );
    const instanceBuffer = res.bufferManager.createInstanceBuffer(createAttributes(points));

    ctx._renderQueue.enqueue({
      pipeline: res.instancedPipeline,
      drawCounts: [6, items.length - 1],
      vertexBuffers: [instanceBuffer],
      bindGroups: [uniformBindGroup],
      clip,
    });
  } else {
    // Accumulate segments of consecutive line marks into one draw call
    // (e.g. parallel coordinates). Resolution and offset travel per instance.
    ctx._renderQueue.setupBatch({
      device,
      vertexManager: res.batchVertexManager,
      pipeline: res.batchPipeline,
      clip,
      bindGroups: [],
    });
    const resolution = res.bufferManager.getResolution();
    const offset = res.bufferManager.getOffset();
    for (let i = 0; i < points.length - 1; i++) {
      const { x = 0, y = 0, stroke, strokeOpacity = 1, strokeWidth = 1, opacity = 1 } = points[i];
      const x2 = points[i + 1].x ?? 0;
      const y2 = points[i + 1].y ?? 0;
      const col = Color.from2(stroke, opacity, strokeOpacity);

      ctx._renderQueue.queueBatchInstance([
        x,
        y,
        x2,
        y2,
        col[0],
        col[1],
        col[2],
        col[3],
        strokeWidth,
        resolution[0],
        resolution[1],
        offset[0],
        offset[1],
      ]);
    }
  }

  // Round joins: fill the gap at each interior vertex where two segment quads
  // meet at an angle (otherwise the outer corner of every bend is notched).
  if (points.length > 2) {
    const joinData = createJoinAttributes(points);
    if (joinData.length > 0) {
      const joinUniformBindGroup = createUniformBindGroup(
        `${drawName}Join`,
        device,
        res.joinPipeline,
        res.bufferManager.createUniformBuffer(),
      );
      ctx._renderQueue.enqueue({
        pipeline: res.joinPipeline,
        drawCounts: [JOIN_SEGMENTS * 3, points.length - 2],
        vertexBuffers: [res.joinGeometryBuffer, res.bufferManager.createInstanceBuffer(joinData)],
        bindGroups: [joinUniformBindGroup],
        clip,
      });
    }
  }
}

/** Symbol-shader instance data for a filled circle at each interior vertex. */
function createJoinAttributes(points: SceneLinePoint[]): Float32Array {
  const count = points.length - 2;
  const result = new Float32Array(count * 12);
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const { x = 0, y = 0, stroke, strokeOpacity = 1, strokeWidth = 1, opacity = 1 } = points[i];
    const col = Color.from2(stroke, opacity, strokeOpacity);
    result[index] = x;
    result[index + 1] = y;
    result[index + 2] = strokeWidth / 2; // radius
    result[index + 3] = col[0];
    result[index + 4] = col[1];
    result[index + 5] = col[2];
    result[index + 6] = col[3];
    // transparent stroke, zero stroke width -> a plain filled circle
    result[index + 11] = 0;
    index += 12;
  }
  return result;
}

/** Unit-circle triangle fan matching the symbol geometry (scaled in-shader). */
function createJoinGeometry(): Float32Array {
  return new Float32Array(
    Array.from({ length: JOIN_SEGMENTS }, (_, i) => {
      const j = (i + 1) % JOIN_SEGMENTS;
      const ang1 = ((Math.PI * 2.0) / JOIN_SEGMENTS) * i;
      const ang2 = ((Math.PI * 2.0) / JOIN_SEGMENTS) * j;
      return [Math.cos(ang1), Math.sin(ang1), 0, 0, Math.cos(ang2), Math.sin(ang2)];
    }).flat(),
  );
}

function createAttributes(points: SceneLinePoint[]): Float32Array {
  const result = new Float32Array((points.length - 1) * 9);
  for (let i = 0; i < points.length - 1; i++) {
    const { x = 0, y = 0, stroke, strokeOpacity = 1, strokeWidth = 1, opacity = 1 } = points[i];
    const x2 = points[i + 1].x ?? 0;
    const y2 = points[i + 1].y ?? 0;
    const col = Color.from2(stroke, opacity, strokeOpacity);

    const index = i * 9;
    result[index] = x;
    result[index + 1] = y;
    result[index + 2] = x2;
    result[index + 3] = y2;
    result[index + 4] = col[0];
    result[index + 5] = col[1];
    result[index + 6] = col[2];
    result[index + 7] = col[3];
    result[index + 8] = strokeWidth;
  }
  return result;
}

export default {
  type: 'line',
  draw,
} satisfies MarkModule;
