import { LruMap } from './lru.js';

// A scene has few distinct group offsets, so this collapses to a handful.
const MAX_UNIFORM_CACHE = 128;

/**
 * Buffers a frame's draws create, and resources they replace, released once
 * the frame is submitted.
 *
 * A mark mints a buffer per draw and WebGPU frees none of them on its own, so
 * a hovered chart was creating hundreds a frame and holding every one, which
 * reached tens of gigabytes. Destroying is safe after submit: an implementation
 * keeps a buffer alive until the commands referencing it have run.
 */
class FrameBuffers {
  private current: { destroy(): void }[] = [];
  private previous: { destroy(): void }[] = [];

  hold<T extends { destroy(): void }>(resource: T): T {
    this.current.push(resource);
    return resource;
  }

  /**
   * Frees the frame before last. A capture and an image that finishes loading
   * both submit again around a frame, so a buffer is only let go once a later
   * frame has been through as well.
   */
  release(): void {
    for (const resource of this.previous) {
      resource.destroy();
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

/**
 * A mark's buffers and the uniform block they share. getMarkResources sets the
 * resolution, offset and clip before every draw, since the manager outlives the
 * frame that made it.
 */
/**
 * Uploads through the queue rather than mappedAtCreation. A mapped range
 * costs one JS ArrayBuffer per buffer and a frame creates a buffer per mark,
 * which exhausts that allocation on a memory-constrained runner: every
 * create then throws "size (32) is too large for the implementation".
 *
 * `lasting` keeps the buffer out of the frame pool, for the few that are held
 * across frames rather than rebuilt.
 */
export function uploadBuffer(
  device: GPUDevice,
  label: string,
  data: Uint16Array | Uint32Array | Float32Array,
  usage: GPUBufferUsageFlags,
  lasting = false,
): GPUBuffer {
  const size = (data.byteLength + 3) & ~3;
  const buffer = device.createBuffer({ label, size, usage });
  if (!lasting) {
    bufferPool(device).hold(buffer);
  }
  const bytes = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  // writeBuffer copies whole words, so an unaligned tail needs padding
  let src = bytes;
  if (size !== data.byteLength) {
    src = new Uint8Array(size);
    src.set(bytes);
  }
  device.queue.writeBuffer(buffer, 0, src, 0, size);
  return buffer;
}

export class BufferManager {
  // a draw queued this frame may still read an evicted one, so the pool frees it later
  private uniformCache = new LruMap<string, GPUBuffer>(MAX_UNIFORM_CACHE, buffer =>
    bufferPool(this.device).hold(buffer),
  );
  private resolution: [width: number, height: number] = [0, 0];
  private offset: [x: number, y: number] = [0, 0];
  private dpi = 1;
  private clip: [number, number, number, number] = [0, 0, 0, 0];
  private clipRadii: [number, number, number, number] = [0, 0, 0, 0];
  private clipMask: [number, number, number, number] = [0, 0, 0, 0];

  constructor(
    private readonly device: GPUDevice,
    private readonly bufferName: string,
  ) {}

  createUniformBuffer(): GPUBuffer {
    return uploadBuffer(
      this.device,
      `${this.bufferName} Uniform Buffer`,
      this.uniformValues(),
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
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
      buffer = uploadBuffer(
        this.device,
        `${this.bufferName} Uniform`,
        values,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        true,
      );
      this.uniformCache.set(key, buffer);
    }
    return buffer;
  }

  createGeometryBuffer(data: Float32Array, lasting = false): GPUBuffer {
    return uploadBuffer(
      this.device,
      `${this.bufferName} Geometry Buffer`,
      data,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      lasting,
    );
  }

  createInstanceBuffer(data: Float32Array): GPUBuffer {
    return uploadBuffer(
      this.device,
      `${this.bufferName} Instance Buffer`,
      data,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    );
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

  /**
   * The rounded clip every draw from this mark is held to. A scissor rect is
   * exact for a plain box and already carries every clip in the chain, so the
   * shader is only told about the box whose corners it has to cut.
   */
  setClipRound(round?: { box: readonly number[]; radii: readonly number[] }): void {
    const box = round?.box;
    const radii = round?.radii;
    this.clip = [box?.[0] ?? 0, box?.[1] ?? 0, box?.[2] ?? 0, box?.[3] ?? 0];
    this.clipRadii = [radii?.[0] ?? 0, radii?.[1] ?? 0, radii?.[2] ?? 0, radii?.[3] ?? 0];
  }

  /**
   * Whether a clip path's coverage mask is bound and should be read. The mask
   * itself is a texture binding, and this is what tells the shader to look at
   * it rather than at the placeholder bound when there is no path clip.
   */
  setClipMask(on: boolean): void {
    this.clipMask = [on ? 1 : 0, 0, 0, 0];
  }

  /** The shared uniform block: resolution, group offset and device pixel ratio. */
  private uniformValues(): Float32Array {
    return new Float32Array([
      ...this.resolution,
      ...this.offset,
      ...this.clip,
      ...this.clipRadii,
      ...this.clipMask,
      this.dpi,
      0,
      0,
      0,
    ]);
  }
}
