import { formatElementCount, formatSize } from './formatSize.js';

function layoutOf(
  formats: GPUVertexFormat[],
  stepMode: GPUVertexStepMode,
  locationOffset: number,
): GPUVertexBufferLayout {
  const attributes: GPUVertexAttribute[] = [];
  let totalOffset = 0;
  formats.forEach((format, index) => {
    const size = formatSize(format);
    if (size > 0) {
      attributes.push({ shaderLocation: index + locationOffset, offset: totalOffset, format });
      totalOffset += size;
    } else {
      console.error(`[vega-webgpu] Unsupported vertex format: ${format}`);
    }
  });
  return { arrayStride: totalOffset, stepMode, attributes };
}

function lengthOf(formats: GPUVertexFormat[]): number {
  return formats.reduce((total, format) => total + formatElementCount(format), 0);
}

/**
 * Derives GPUVertexBufferLayouts (one per-vertex, one per-instance) from lists
 * of vertex formats, assigning consecutive shader locations.
 *
 * The formats are fixed at construction, so everything derived from them is
 * built once. `layoutKey` is what a pipeline cache keys on, and building it
 * here rather than at every lookup keeps a per-draw JSON.stringify of the whole
 * layout off the hot path.
 */
export class VertexBufferManager {
  private readonly buffers: GPUVertexBufferLayout[];
  private readonly vertexLength: number;
  private readonly instanceLength: number;
  readonly layoutKey: string;

  constructor(vertexFormats: GPUVertexFormat[] = [], instanceFormats: GPUVertexFormat[] = []) {
    this.vertexLength = lengthOf(vertexFormats);
    this.instanceLength = lengthOf(instanceFormats);
    this.buffers = [];
    if (this.vertexLength > 0) {
      this.buffers.push(layoutOf(vertexFormats, 'vertex', 0));
    }
    if (this.instanceLength > 0) {
      this.buffers.push(layoutOf(instanceFormats, 'instance', vertexFormats.length));
    }
    this.layoutKey = JSON.stringify(this.buffers);
  }

  /** Layouts for pipeline creation; empty layouts are omitted. */
  getBuffers(): GPUVertexBufferLayout[] {
    return this.buffers;
  }

  /** Number of float elements per vertex. */
  getVertexLength(): number {
    return this.vertexLength;
  }

  /** Number of float elements per instance. */
  getInstanceLength(): number {
    return this.instanceLength;
  }
}
