import { LruMap } from './lru.js';

// A scene has few distinct group offsets, so this collapses to a handful.
const MAX_UNIFORM_CACHE = 128;

/**
 * The shared uniform block as the shaders read it: resolution, group offset,
 * the rounded clip's box and radii, the clip mask flag and the device pixel
 * ratio, padded to a whole number of vec4s.
 */
const UNIFORM_FLOATS = 20;
const OFFSET = 2;
const CLIP_BOX = 4;
const CLIP_RADII = 8;
const CLIP_MASK = 12;
const DPI = 16;

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

/**
 * A mark's buffers and the uniform block they share. getMarkResources sets the
 * resolution, offset and clip before every draw, since the manager outlives the
 * frame that made it.
 */
export class BufferManager {
  // a draw queued this frame may still read an evicted one, so the pool frees it later
  private uniformCache = new LruMap<string, GPUBuffer>(MAX_UNIFORM_CACHE, buffer =>
    bufferPool(this.device).hold(buffer),
  );
  private readonly uniforms = new Float32Array(UNIFORM_FLOATS);
  /** The uniforms as the shared buffer cache keys them, until a setter changes one. */
  private uniformKey: string | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly bufferName: string,
  ) {
    this.uniforms[DPI] = 1;
  }

  createUniformBuffer(): GPUBuffer {
    return uploadBuffer(
      this.device,
      `${this.bufferName} Uniform Buffer`,
      this.uniforms,
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
    const key = (this.uniformKey ??= this.uniforms.join(','));
    let buffer = this.uniformCache.get(key);
    if (!buffer) {
      // cached across frames by value, so it cannot come from the frame pool
      buffer = uploadBuffer(
        this.device,
        `${this.bufferName} Uniform`,
        this.uniforms,
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

  setResolution([width, height]: readonly [width: number, height: number]): void {
    this.setUniform(0, width);
    this.setUniform(1, height);
  }

  setOffset(x: number, y: number): void {
    this.setUniform(OFFSET, x);
    this.setUniform(OFFSET + 1, y);
  }

  setDpi(dpi: number): void {
    this.setUniform(DPI, dpi || 1);
  }

  /**
   * The rounded clip every draw from this mark is held to. A scissor rect is
   * exact for a plain box and already carries every clip in the chain, so the
   * shader is only told about the box whose corners it has to cut.
   */
  setClipRound(round?: { box: readonly number[]; radii: readonly number[] }): void {
    for (let i = 0; i < 4; i++) {
      this.setUniform(CLIP_BOX + i, round?.box[i] ?? 0);
      this.setUniform(CLIP_RADII + i, round?.radii[i] ?? 0);
    }
  }

  /**
   * Whether a clip path's coverage mask is bound and should be read. The mask
   * itself is a texture binding, and this is what tells the shader to look at
   * it rather than at the placeholder bound when there is no path clip.
   */
  setClipMask(on: boolean): void {
    this.setUniform(CLIP_MASK, on ? 1 : 0);
  }

  private setUniform(index: number, value: number): void {
    const stored = Math.fround(value);
    if (this.uniforms[index] !== stored) {
      this.uniforms[index] = stored;
      this.uniformKey = null;
    }
  }
}
