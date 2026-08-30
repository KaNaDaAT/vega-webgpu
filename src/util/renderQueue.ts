import type { ClipRect } from '../types/context.js';
import { BufferManager } from './bufferManager.js';
import type { VertexBufferManager } from './vertexManager.js';

export type DrawCounts = [vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number];

export interface QueueElement {
  pipeline: GPURenderPipeline;
  drawCounts: DrawCounts;
  vertexBuffers: GPUBuffer[];
  bindGroups: GPUBindGroup[];
  clip?: ClipRect;
}

export interface RenderBatchInfo {
  device: GPUDevice;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  clip?: ClipRect;
  bindGroups: GPUBindGroup[];
  geometryBuffer?: GPUBuffer;
  geometryCount?: number;
}

/**
 * Collects draw calls for one frame and submits them in a single command
 * buffer. Each WebGPURenderer instance owns its own queue, so multiple
 * views on a page do not interfere with each other.
 */
export class RenderQueue {
  private queue: QueueElement[] = [];
  private batch: number[] = [];
  private batchInfo: RenderBatchInfo | null = null;

  startFrame(): void {
    this.queue = [];
    this.batch = [];
    this.batchInfo = null;
  }

  enqueue(element: QueueElement): void {
    if (this.batchInfo !== null && element.pipeline !== this.batchInfo.pipeline) {
      this.flushBatch();
    }
    this.queue.push(element);
  }

  /**
   * Starts collecting instances that share one pipeline (e.g. the segments
   * of many line marks) so they can be issued as a single draw call.
   * A subsequent draw with a different pipeline flushes the batch, keeping
   * the paint order of the scenegraph intact.
   */
  setupBatch(info: RenderBatchInfo): void {
    if (this.batchInfo !== null && this.batchInfo.pipeline === info.pipeline) {
      return;
    }
    this.flushBatch();
    this.batch = [];
    this.batchInfo = info;
  }

  queueBatchInstance(values: number[]): void {
    this.batch.push(...values);
  }

  flushBatch(): void {
    const info = this.batchInfo;
    if (info === null || this.batch.length === 0) {
      this.batchInfo = null;
      return;
    }
    this.batchInfo = null;

    const data = new BufferManager(info.device, 'RenderBatch').createInstanceBuffer(Float32Array.from(this.batch));
    const instanceCount = this.batch.length / info.vertexManager.getInstanceLength();
    this.batch = [];

    if (info.geometryBuffer == null) {
      this.enqueue({
        pipeline: info.pipeline,
        drawCounts: [6, instanceCount],
        vertexBuffers: [data],
        bindGroups: info.bindGroups,
        clip: info.clip,
      });
    } else {
      this.enqueue({
        pipeline: info.pipeline,
        drawCounts: [info.geometryCount ?? 1, instanceCount],
        vertexBuffers: [info.geometryBuffer, data],
        bindGroups: info.bindGroups,
        clip: info.clip,
      });
    }
  }

  /**
   * Encodes all queued draws into render passes and submits them.
   * Scissor rects are clamped to the attachment size. WebGPU validation
   * rejects scissor rects that extend beyond the render target.
   */
  submit(
    device: GPUDevice,
    renderPassDescriptor: GPURenderPassDescriptor,
    attachmentSize: [width: number, height: number],
  ): void {
    this.flushBatch();
    const commandEncoder = device.createCommandEncoder({ label: 'RenderQueue Encoder' });
    // All draws share one render pass: the attachment is loaded/cleared and
    // resolved exactly once per frame. Draw order = scenegraph paint order.
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    let scissored = false;
    for (const q of this.queue) {
      const clip = q.clip && clampClip(q.clip, attachmentSize);
      if (clip) {
        passEncoder.setScissorRect(clip[0], clip[1], clip[2], clip[3]);
        scissored = true;
      } else if (scissored) {
        // scissor state persists within the pass, so restore full coverage
        passEncoder.setScissorRect(0, 0, attachmentSize[0], attachmentSize[1]);
        scissored = false;
      }
      passEncoder.setPipeline(q.pipeline);
      for (let i = 0; i < q.vertexBuffers.length; i++) {
        passEncoder.setVertexBuffer(i, q.vertexBuffers[i]);
      }
      for (let i = 0; i < q.bindGroups.length; i++) {
        passEncoder.setBindGroup(i, q.bindGroups[i]);
      }
      passEncoder.draw(q.drawCounts[0], q.drawCounts[1] ?? 1, q.drawCounts[2] ?? 0, q.drawCounts[3] ?? 0);
    }
    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);
    this.queue = [];
  }
}

function clampClip(clip: ClipRect, size: [number, number]): ClipRect | undefined {
  const x = Math.min(Math.max(Math.floor(clip[0]), 0), size[0]);
  const y = Math.min(Math.max(Math.floor(clip[1]), 0), size[1]);
  const w = Math.min(Math.max(Math.floor(clip[2]), 0), size[0] - x);
  const h = Math.min(Math.max(Math.floor(clip[3]), 0), size[1] - y);
  if (w <= 0 || h <= 0) {
    return undefined;
  }
  return [x, y, w, h];
}
