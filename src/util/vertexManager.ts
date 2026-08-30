import { formatElementCount, formatSize } from './formatSize.js';

/**
 * Derives GPUVertexBufferLayouts (one per-vertex, one per-instance) from
 * lists of vertex formats, assigning consecutive shader locations.
 */
export class VertexBufferManager {
  private vertexFormats: GPUVertexFormat[];
  private instanceFormats: GPUVertexFormat[];
  private readonly vertexLocationOffset: number;
  private readonly instanceLocationOffset: number;

  private vertexLayout: GPUVertexBufferLayout | null = null;
  private instanceLayout: GPUVertexBufferLayout | null = null;
  private vertexLength = 0;
  private instanceLength = 0;
  private dirty = true;

  constructor(
    vertexFormats: GPUVertexFormat[] = [],
    instanceFormats: GPUVertexFormat[] = [],
    vertexLocationOffset = 0,
    instanceLocationOffset?: number,
  ) {
    this.vertexFormats = vertexFormats;
    this.instanceFormats = instanceFormats;
    this.vertexLocationOffset = vertexLocationOffset;
    this.instanceLocationOffset = instanceLocationOffset ?? vertexLocationOffset + vertexFormats.length;
  }

  private calculateLayout(stepMode: GPUVertexStepMode): GPUVertexBufferLayout {
    const formats = stepMode === 'vertex' ? this.vertexFormats : this.instanceFormats;
    const locationOffset = stepMode === 'vertex' ? this.vertexLocationOffset : this.instanceLocationOffset;
    const attributes: GPUVertexAttribute[] = [];
    let totalOffset = 0;
    formats.forEach((format, index) => {
      const size = formatSize(format);
      if (size > 0) {
        attributes.push({
          shaderLocation: index + locationOffset,
          offset: totalOffset,
          format,
        });
        totalOffset += size;
      } else {
        console.error(`[vega-webgpu] Unsupported vertex format: ${format}`);
      }
    });

    return {
      arrayStride: totalOffset,
      stepMode,
      attributes,
    };
  }

  private calculateLength(stepMode: GPUVertexStepMode): number {
    const formats = stepMode === 'vertex' ? this.vertexFormats : this.instanceFormats;
    return formats.reduce((total, format) => total + formatElementCount(format), 0);
  }

  private process(): void {
    if (this.dirty) {
      this.vertexLayout = this.calculateLayout('vertex');
      this.instanceLayout = this.calculateLayout('instance');
      this.vertexLength = this.calculateLength('vertex');
      this.instanceLength = this.calculateLength('instance');
      this.dirty = false;
    }
  }

  pushFormats(stepMode: GPUVertexStepMode, formats: GPUVertexFormat[]): void {
    const target = stepMode === 'vertex' ? this.vertexFormats : this.instanceFormats;
    target.push(...formats);
    this.dirty = true;
  }

  clear(): void {
    this.vertexFormats = [];
    this.instanceFormats = [];
    this.dirty = true;
  }

  /** Layouts for pipeline creation; empty layouts are omitted. */
  getBuffers(): GPUVertexBufferLayout[] {
    this.process();
    const buffers: GPUVertexBufferLayout[] = [];
    if (this.vertexLength > 0 && this.vertexLayout) {
      buffers.push(this.vertexLayout);
    }
    if (this.instanceLength > 0 && this.instanceLayout) {
      buffers.push(this.instanceLayout);
    }
    return buffers;
  }

  /** Number of float elements per vertex. */
  getVertexLength(): number {
    this.process();
    return this.vertexLength;
  }

  /** Number of float elements per instance. */
  getInstanceLength(): number {
    this.process();
    return this.instanceLength;
  }
}
