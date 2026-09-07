// A scene has few distinct group offsets, so this collapses to a handful.
const MAX_UNIFORM_CACHE = 128;

/**
 * Buffers a frame's draws create, released once the frame is submitted.
 *
 * A mark mints a buffer per draw and WebGPU frees none of them on its own, so
 * a hovered chart was creating hundreds a frame and holding every one, which
 * reached tens of gigabytes. Destroying is safe after submit: an implementation
 * keeps a buffer alive until the commands referencing it have run.
 */
class FrameBuffers {
  private current: GPUBuffer[] = [];
  private previous: GPUBuffer[] = [];

  hold(buffer: GPUBuffer): GPUBuffer {
    this.current.push(buffer);
    return buffer;
  }

  /**
   * Frees the frame before last. A capture and an image that finishes loading
   * both submit again around a frame, so a buffer is only let go once a later
   * frame has been through as well.
   */
  release(): void {
    for (const buffer of this.previous) {
      buffer.destroy();
    }
    this.previous = this.current;
    this.current = [];
  }
}

const pools = new WeakMap<GPUDevice, FrameBuffers>();

/** The frame's buffers for a device, which die with it. */
export function bufferPool(device: GPUDevice): FrameBuffers {
  let pool = pools.get(device);
  if (!pool) {
    pool = new FrameBuffers();
    pools.set(device, pool);
  }
  return pool;
}

export class BufferManager {
  private device: GPUDevice;
  private uniformCache = new Map<string, GPUBuffer>();
  private bufferName: string;
  private resolution: [width: number, height: number];
  private offset: [x: number, y: number];
  private dpi = 1;

  constructor(
    device: GPUDevice,
    bufferName = 'Unknown',
    resolution: [width: number, height: number] = [0, 0],
    offset: [x: number, y: number] = [0, 0],
  ) {
    this.device = device;
    this.bufferName = bufferName;
    this.resolution = resolution;
    this.offset = offset;
  }

  createUniformBuffer(
    data?: Float32Array,
    usage: GPUBufferUsageFlags = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  ): GPUBuffer {
    const values = data ?? this.uniformValues();
    return this.createBuffer(`${this.bufferName} Uniform Buffer`, values, usage);
  }

  /**
   * Uniform buffer for the current resolution and offset, reused across draws
   * that share them. Marks that draw many times per frame would otherwise mint
   * one per draw. Keyed by the values rather than shared outright, because the
   * render queue defers every draw to the end of the frame: one buffer rewritten
   * per group would hand every draw the last group's offset.
   */
  sharedUniformBuffer(): GPUBuffer {
    const values = this.uniformValues();
    const key = values.join(',');
    let buffer = this.uniformCache.get(key);
    if (!buffer) {
      // cached across frames by value, so it cannot come from the frame pool
      buffer = this.createBuffer(
        `${this.bufferName} Uniform`,
        values,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        true,
      );
      if (this.uniformCache.size >= MAX_UNIFORM_CACHE) {
        const oldest = this.uniformCache.keys().next().value;
        if (oldest !== undefined) {
          this.uniformCache.delete(oldest);
        }
      }
      this.uniformCache.set(key, buffer);
    }
    return buffer;
  }

  createGeometryBuffer(
    data: Float32Array,
    usage: GPUBufferUsageFlags = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    lasting = false,
  ): GPUBuffer {
    return this.createBuffer(`${this.bufferName} Geometry Buffer`, data, usage, lasting);
  }

  createInstanceBuffer(
    data: Uint16Array | Uint32Array | Float32Array,
    usage: GPUBufferUsageFlags = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  ): GPUBuffer {
    return this.createBuffer(`${this.bufferName} Instance Buffer`, data, usage);
  }

  /**
   * Uploads through the queue rather than mappedAtCreation. A mapped range
   * costs one JS ArrayBuffer per buffer and a frame creates a buffer per mark,
   * which exhausts that allocation on a memory-constrained runner: every
   * create then throws "size (32) is too large for the implementation".
   */
  /**
   * `lasting` keeps the buffer out of the frame pool, for the few that are held
   * across frames rather than rebuilt.
   */
  createBuffer(
    name: string,
    data: Uint16Array | Uint32Array | Float32Array,
    usage: GPUBufferUsageFlags,
    lasting = false,
  ): GPUBuffer {
    const size = (data.byteLength + 3) & ~3;
    const buffer = this.device.createBuffer({ label: name, size, usage });
    if (!lasting) {
      bufferPool(this.device).hold(buffer);
    }
    const bytes = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    // writeBuffer copies whole words, so an unaligned tail needs padding
    let src = bytes;
    if (size !== data.byteLength) {
      src = new Uint8Array(size);
      src.set(bytes);
    }
    this.device.queue.writeBuffer(buffer, 0, src, 0, size);
    return buffer;
  }

  getDevice(): GPUDevice {
    return this.device;
  }

  getBufferName(): string {
    return this.bufferName;
  }

  getResolution(): [width: number, height: number] {
    return this.resolution;
  }

  getOffset(): [x: number, y: number] {
    return this.offset;
  }

  setResolution(resolution: [width: number, height: number]): void {
    this.resolution = resolution;
  }

  setOffset(offset: [x: number, y: number]): void {
    this.offset = offset;
  }

  setDpi(dpi: number): void {
    this.dpi = dpi || 1;
  }

  /** The shared uniform block: resolution, group offset and device pixel ratio. */
  private uniformValues(): Float32Array {
    return new Float32Array([...this.resolution, ...this.offset, this.dpi, 0, 0, 0]);
  }
}
