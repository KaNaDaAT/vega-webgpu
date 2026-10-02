import type { ClipRect } from '../types/context.js';
import { layerMode } from './blend.js';
import { BufferManager } from './bufferManager.js';
import type { GpuTimer } from './gpuTimer.js';
import type { VertexBufferManager } from './vertexManager.js';

export type DrawCounts = [vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number];

export interface QueueElement {
  pipeline: GPURenderPipeline;
  drawCounts: DrawCounts;
  vertexBuffers: GPUBuffer[];
  bindGroups: GPUBindGroup[];
  clip?: ClipRect;
  /**
   * Drawn somewhere other than the frame. A run of these breaks the frame's
   * pass, fills a cleared target, and the composite that follows reads it back.
   * `mask` is coverage alone (shaders/maskComposite.ts) and `layer` is the
   * mark's own colour over a copy of the frame (shaders/blendComposite.ts).
   */
  pass?: 'mask' | 'layer';
  /** Where a mask run draws, for a clip path that needs a target of its own. */
  maskView?: GPUTextureView;
  /** Where that run resolves to, where it is multisampled. */
  maskResolve?: GPUTextureView;
}

/** Where a frame draws, beyond its own attachment. */
export interface FrameTargets {
  /** What the frame resolves into, which a backdrop copy reads. */
  target: GPUTexture;
  maskView: GPUTextureView;
  /** Multisampled when the frame is, in which case `layerResolve` follows it. */
  layerView: GPUTextureView;
  layerResolve: GPUTextureView | null;
  backdrop: GPUTexture;
}

export interface RenderBatchInfo {
  device: GPUDevice;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  clip?: ClipRect;
  bindGroups: GPUBindGroup[];
  /** Vertices per instance. Defaults to a quad. */
  vertexCount?: number;
}

/** Builds the draw that folds a layer back into the frame. */
export type Compositor = (blend: string, clip: ClipRect | undefined) => QueueElement;

/**
 * Collects draw calls for one frame and submits them in a single command
 * buffer. Each WebGPURenderer instance owns its own queue, so multiple
 * views on a page do not interfere with each other.
 */
export class RenderQueue {
  private queue: QueueElement[] = [];
  private batch: ArrayLike<number>[] = [];
  private batchLength = 0;
  private batchInfo: RenderBatchInfo | null = null;
  private offFrame = false;
  private compositor: Compositor | null = null;

  /** Starts a frame, with the compositor its layered draws fold back through. */
  startFrame(compositor: Compositor): void {
    this.queue = [];
    this.batch = [];
    this.batchLength = 0;
    this.batchInfo = null;
    this.offFrame = false;
    this.compositor = compositor;
  }

  /** Whether anything this frame draws somewhere other than the frame itself. */
  drawsOffFrame(): boolean {
    // an open batch only joins the queue when it closes, and it may be a layer
    this.flushBatch();
    return this.offFrame;
  }

  enqueue(element: QueueElement): void {
    // A direct draw comes after everything the open batch has collected, and
    // the batch is only appended when it flushes, so it has to close first.
    // Closing only on a different pipeline let a draw that shares one jump in
    // front of it, and markPipeline keys on the layout rather than the label,
    // so every mark's outline pipeline is the same object as a line's batch.
    // Runs still merge across marks: setupBatch keeps an open batch whose
    // target matches, which is where that happens.
    if (this.batchInfo !== null) {
      this.flushBatch();
    }
    // A mode the blend state cannot express draws into a layer and is folded in
    // straight after, so each draw meets the frame on its own the way canvas
    // composites a fill and then a stroke.
    const blend = layerMode(element.pipeline);
    if (blend !== undefined && this.compositor) {
      this.offFrame = true;
      this.queue.push({ ...element, pass: 'layer' });
      this.queue.push(this.compositor(blend, element.clip));
      return;
    }
    if (element.pass) {
      this.offFrame = true;
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
    if (this.batchInfo !== null && sameBatchTarget(this.batchInfo, info)) {
      return;
    }
    this.flushBatch();
    this.batch = [];
    this.batchLength = 0;
    this.batchInfo = info;
  }

  /**
   * Adds one mark's instances to the open batch. Held rather than copied out,
   * since spreading them into an array throws past about 125 thousand values,
   * which a line of seven thousand points reaches.
   */
  queueBatchInstance(values: ArrayLike<number>): void {
    if (values.length === 0) {
      return;
    }
    this.batch.push(values);
    this.batchLength += values.length;
  }

  private flushBatch(): void {
    const info = this.batchInfo;
    if (info === null || this.batchLength === 0) {
      this.batchInfo = null;
      return;
    }
    this.batchInfo = null;

    const values = new Float32Array(this.batchLength);
    let at = 0;
    for (const chunk of this.batch) {
      values.set(chunk, at);
      at += chunk.length;
    }
    const data = new BufferManager(info.device, 'RenderBatch').createInstanceBuffer(values);
    const instanceCount = this.batchLength / info.vertexManager.getInstanceLength();
    this.batch = [];
    this.batchLength = 0;

    this.enqueue({
      pipeline: info.pipeline,
      drawCounts: [info.vertexCount ?? 6, instanceCount],
      vertexBuffers: [data],
      bindGroups: info.bindGroups,
      clip: info.clip,
    });
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
    timer?: GpuTimer | null,
    targets?: FrameTargets | null,
  ): void {
    this.flushBatch();
    const queue = this.queue;
    this.queue = [];
    const commandEncoder = device.createCommandEncoder({ label: 'RenderQueue Encoder' });
    if (targets && queue.some(q => q.pass)) {
      encodeSplit(commandEncoder, renderPassDescriptor, queue, attachmentSize, targets);
    } else {
      // All draws share one render pass: the attachment is loaded/cleared and
      // resolved exactly once per frame. Draw order = scenegraph paint order.
      const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
      let scissored = false;
      for (const q of queue) {
        scissored = encodeDraw(passEncoder, q, attachmentSize, scissored);
      }
      passEncoder.end();
    }
    timer?.resolve(commandEncoder);
    device.queue.submit([commandEncoder.finish()]);
    timer?.sample();
  }
}

/**
 * The same draws, with each run of off-frame elements lifted into a pass of its
 * own. The frame's pass is broken either side of the run and resumed with a
 * load, so the only difference the frame sees is that the composite following
 * the run reads a finished target.
 *
 * A mask run needs nothing of the frame, so the pass before it can skip its
 * MSAA resolve. A layer run reads the frame underneath the mark, so the pass
 * before that one has to resolve before the copy. The timer keeps its two
 * stamps across the whole set, and a pass carrying neither is rejected.
 */
function encodeSplit(
  encoder: GPUCommandEncoder,
  descriptor: GPURenderPassDescriptor,
  queue: QueueElement[],
  attachmentSize: [width: number, height: number],
  targets: FrameTargets,
): void {
  const attachment = [...descriptor.colorAttachments][0] as GPURenderPassColorAttachment;
  const stamps = descriptor.timestampWrites;
  const segments: { kind: 'frame' | 'mask' | 'layer'; items: QueueElement[] }[] = [];
  for (const q of queue) {
    const kind = q.pass ?? 'frame';
    const last = segments[segments.length - 1];
    // A run draws into one target, so two masks with different ones cannot
    // share a pass however adjacent they are.
    if (last && last.kind === kind && last.items[0].maskView === q.maskView) {
      last.items.push(q);
    } else {
      segments.push({ kind, items: [q] });
    }
  }
  const runs = segments.filter(seg => seg.kind !== 'frame');
  const frames = runs.length + 1;

  const beginFrame = (index: number): GPURenderPassEncoder => {
    const colour: GPURenderPassColorAttachment = { ...attachment };
    if (index > 0) {
      colour.loadOp = 'load';
      colour.storeOp = 'store';
    }
    if (index < frames - 1 && runs[index]?.kind !== 'layer') {
      colour.resolveTarget = undefined;
    }
    const pass: GPURenderPassDescriptor = { ...descriptor, colorAttachments: [colour], timestampWrites: undefined };
    if (stamps && (index === 0 || index === frames - 1)) {
      const writes: GPURenderPassTimestampWrites = { querySet: stamps.querySet };
      if (index === 0) {
        writes.beginningOfPassWriteIndex = stamps.beginningOfPassWriteIndex;
      }
      if (index === frames - 1) {
        writes.endOfPassWriteIndex = stamps.endOfPassWriteIndex;
      }
      pass.timestampWrites = writes;
    }
    return encoder.beginRenderPass(pass);
  };

  const beginRun = (kind: 'mask' | 'layer', view?: GPUTextureView, resolve?: GPUTextureView): GPURenderPassEncoder => {
    if (kind === 'mask') {
      return encoder.beginRenderPass({
        label: 'Coverage Mask',
        colorAttachments: [
          {
            view: view ?? targets.maskView,
            resolveTarget: resolve,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
    }
    encoder.copyTextureToTexture({ texture: targets.target }, { texture: targets.backdrop }, [
      attachmentSize[0],
      attachmentSize[1],
      1,
    ]);
    return encoder.beginRenderPass({
      label: 'Blend Layer',
      colorAttachments: [
        {
          view: targets.layerView,
          resolveTarget: targets.layerResolve ?? undefined,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
  };

  let index = 0;
  let passEncoder = beginFrame(0);
  let scissored = false;
  for (const segment of segments) {
    if (segment.kind === 'frame') {
      for (const q of segment.items) {
        scissored = encodeDraw(passEncoder, q, attachmentSize, scissored);
      }
      continue;
    }
    passEncoder.end();
    const runPass = beginRun(segment.kind, segment.items[0].maskView, segment.items[0].maskResolve);
    let runScissored = false;
    for (const q of segment.items) {
      runScissored = encodeDraw(runPass, q, attachmentSize, runScissored);
    }
    runPass.end();
    index++;
    passEncoder = beginFrame(index);
    scissored = false;
  }
  passEncoder.end();
}

/** Encodes one draw, returning whether a scissor rect is left set on the pass. */
function encodeDraw(
  passEncoder: GPURenderPassEncoder,
  q: QueueElement,
  attachmentSize: [width: number, height: number],
  scissored: boolean,
): boolean {
  let clip: ClipRect | undefined;
  if (q.clip) {
    const clamped = clampClip(q.clip, attachmentSize);
    if (clamped === null) {
      return scissored; // clipped to nothing
    }
    clip = clamped;
  }
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
  return scissored;
}

/**
 * Instances may only share a draw when the pipeline, the scissor rect and the
 * bind groups all match. Matching on the pipeline alone merged marks from
 * differently clipped groups into one draw carrying the first mark's clip.
 */
function sameBatchTarget(a: RenderBatchInfo, b: RenderBatchInfo): boolean {
  if (a.pipeline !== b.pipeline || a.vertexCount !== b.vertexCount) {
    return false;
  }
  if (!sameClip(a.clip, b.clip)) {
    return false;
  }
  return a.bindGroups.length === b.bindGroups.length && a.bindGroups.every((g, i) => g === b.bindGroups[i]);
}

function sameClip(a: ClipRect | undefined, b: ClipRect | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Returns the clamped rect, or null when it collapses to nothing. */
function clampClip(clip: ClipRect, size: [number, number]): ClipRect | null {
  const x = Math.min(Math.max(Math.floor(clip[0]), 0), size[0]);
  const y = Math.min(Math.max(Math.floor(clip[1]), 0), size[1]);
  const w = Math.min(Math.max(Math.floor(clip[2]), 0), size[0] - x);
  const h = Math.min(Math.max(Math.floor(clip[3]), 0), size[1] - y);
  if (w <= 0 || h <= 0) {
    return null;
  }
  return [x, y, w, h];
}
