export class BufferManager {
  private device: GPUDevice;
  private bufferName: string;
  private resolution: [width: number, height: number];
  private offset: [x: number, y: number];

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
    const values = data ?? new Float32Array([...this.resolution, ...this.offset]);
    return this.createBuffer(`${this.bufferName} Uniform Buffer`, values, usage);
  }

  createGeometryBuffer(
    data: Float32Array,
    usage: GPUBufferUsageFlags = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  ): GPUBuffer {
    return this.createBuffer(`${this.bufferName} Geometry Buffer`, data, usage);
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
  createBuffer(name: string, data: Uint16Array | Uint32Array | Float32Array, usage: GPUBufferUsageFlags): GPUBuffer {
    const size = (data.byteLength + 3) & ~3;
    const buffer = this.device.createBuffer({ label: name, size, usage });
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
}
