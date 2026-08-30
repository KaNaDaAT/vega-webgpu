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

  // source: https://alain.xyz/blog/raw-webgpu
  createBuffer(name: string, data: Uint16Array | Uint32Array | Float32Array, usage: GPUBufferUsageFlags): GPUBuffer {
    const buffer = this.device.createBuffer({
      label: name,
      size: (data.byteLength + 3) & ~3,
      usage,
      mappedAtCreation: true,
    });

    if (data instanceof Uint16Array) {
      new Uint16Array(buffer.getMappedRange()).set(data);
    } else if (data instanceof Uint32Array) {
      new Uint32Array(buffer.getMappedRange()).set(data);
    } else {
      new Float32Array(buffer.getMappedRange()).set(data);
    }
    buffer.unmap();
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
