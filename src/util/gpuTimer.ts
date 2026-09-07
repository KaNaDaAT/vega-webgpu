/** Two timestamps, one frame: the pass start and the pass end. */
const QUERY_COUNT = 2;
const RESOLVE_BYTES = QUERY_COUNT * 8;

/**
 * Measures how long the gpu spent on a frame, using timestamp queries written
 * around the render pass.
 *
 * Waiting on `onSubmittedWorkDone` would give the same answer and stop the cpu
 * from running ahead, which is the thing worth measuring in the first place.
 * These are read back a frame or more later instead, and a frame is skipped
 * while a previous read is still mapping, so the sample rate drops rather than
 * the frame rate.
 */
export class GpuTimer {
  private readonly querySet: GPUQuerySet;
  private readonly resolveBuffer: GPUBuffer;
  private readonly readBuffer: GPUBuffer;
  private reading = false;

  /** Gpu time for the most recently measured frame, in milliseconds. */
  lastMs = 0;

  private constructor(device: GPUDevice) {
    this.querySet = device.createQuerySet({ label: 'Frame Timer', type: 'timestamp', count: QUERY_COUNT });
    this.resolveBuffer = device.createBuffer({
      label: 'Frame Timer Resolve',
      size: RESOLVE_BYTES,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readBuffer = device.createBuffer({
      label: 'Frame Timer Readback',
      size: RESOLVE_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  /** Null where the adapter does not offer timestamps, which is common. */
  static create(device: GPUDevice): GpuTimer | null {
    return device.features.has('timestamp-query') ? new GpuTimer(device) : null;
  }

  /** Passed to beginRenderPass so the gpu stamps the pass boundaries. */
  timestampWrites(): GPURenderPassTimestampWrites {
    return { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }

  /** Copies the stamps out, inside the frame's own encoder. */
  resolve(encoder: GPUCommandEncoder): void {
    encoder.resolveQuerySet(this.querySet, 0, QUERY_COUNT, this.resolveBuffer, 0);
    if (!this.reading) {
      encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, RESOLVE_BYTES);
    }
  }

  /** Reads the previous frame's stamps without blocking this one. */
  sample(): void {
    if (this.reading) {
      return;
    }
    this.reading = true;
    this.readBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const stamps = new BigUint64Array(this.readBuffer.getMappedRange().slice(0));
        this.readBuffer.unmap();
        const elapsed = stamps[1] - stamps[0];
        if (elapsed > 0n) {
          this.lastMs = Number(elapsed) / 1e6;
        }
      })
      .catch(() => {
        // a lost device rejects this, and the pixel output is the real check
      })
      .finally(() => {
        this.reading = false;
      });
  }

  destroy(): void {
    this.querySet.destroy();
    this.resolveBuffer.destroy();
    this.readBuffer.destroy();
  }
}
