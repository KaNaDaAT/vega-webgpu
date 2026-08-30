import type { Bounds } from 'vega-scenegraph';
import type { ClipRect, GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { ItemGeometry } from '../types/geometry.js';
import type { RGBA } from '../util/color.js';
import type WebGPURenderer from '../WebGPURenderer.js';

/** A mark renderer module, as registered in marks/index.ts. */
export interface MarkModule {
  type: string;
  draw: (
    this: WebGPURenderer,
    device: GPUDevice,
    ctx: GPUVegaCanvasContext,
    scene: GPUVegaScene,
    vb: Bounds,
    markTypes?: string[],
  ) => void;
}

/**
 * Returns the GPU resources for a mark type, creating them on first use
 * or after a device change. Resources live on the canvas context, so each
 * renderer instance keeps its own set.
 */
export function getMarkResources<T extends { device: GPUDevice }>(
  ctx: GPUVegaCanvasContext,
  markType: string,
  device: GPUDevice,
  create: () => T,
): T {
  const cached = ctx._markCache[markType] as T | undefined;
  if (cached && cached.device === device) {
    return cached;
  }
  const created = create();
  ctx._markCache[markType] = created;
  return created;
}

/**
 * Interleaves triangulated fill and stroke geometry with their colors
 * into [x, y, z, r, g, b, a] vertex buffers.
 */
export function geometryVertexData(
  geometry: ItemGeometry,
  fill: RGBA,
  stroke: RGBA,
): [fillData: Float32Array, strokeData: Float32Array] {
  const fillData = new Float32Array(geometry.fillCount * 7);
  const strokeData = new Float32Array(geometry.strokeCount * 7);
  for (let i = 0; i < geometry.fillCount; i++) {
    fillData[i * 7] = geometry.fillTriangles[i * 3];
    fillData[i * 7 + 1] = geometry.fillTriangles[i * 3 + 1];
    fillData[i * 7 + 2] = geometry.fillTriangles[i * 3 + 2] * -1;
    fillData[i * 7 + 3] = fill[0];
    fillData[i * 7 + 4] = fill[1];
    fillData[i * 7 + 5] = fill[2];
    fillData[i * 7 + 6] = fill[3];
  }
  for (let i = 0; i < geometry.strokeCount; i++) {
    strokeData[i * 7] = geometry.strokeTriangles[i * 3];
    strokeData[i * 7 + 1] = geometry.strokeTriangles[i * 3 + 1];
    strokeData[i * 7 + 2] = geometry.strokeTriangles[i * 3 + 2] * -1;
    strokeData[i * 7 + 3] = stroke[0];
    strokeData[i * 7 + 4] = stroke[1];
    strokeData[i * 7 + 5] = stroke[2];
    strokeData[i * 7 + 6] = stroke[3];
  }
  return [fillData, strokeData];
}

/**
 * Scissor rect for a mark, in physical pixels. Marks with `clip: true`
 * are clipped to their enclosing group. Otherwise the inherited group
 * clip (if any) applies.
 */
export function markClip(ctx: GPUVegaCanvasContext, scene: GPUVegaScene): ClipRect | undefined {
  if (!scene.clip) {
    return ctx._clip;
  }
  const group = scene.group;
  if (!group) {
    return ctx._clip;
  }
  const dpi = ctx._uniforms.dpi;
  return [
    (ctx._origin[0] + ctx._tx) * dpi,
    (ctx._origin[1] + ctx._ty) * dpi,
    (group.width || 0) * dpi,
    (group.height || 0) * dpi,
  ];
}

/**
 * An item's bounding box in the same coordinate space as its triangulated
 * vertices (group translation applied), as [x, y, w, h] for gradients.
 */
export function gradientBounds(ctx: GPUVegaCanvasContext, bounds: Bounds): [number, number, number, number] {
  return [bounds.x1 + ctx._tx, bounds.y1 + ctx._ty, Math.max(bounds.width(), 1e-6), Math.max(bounds.height(), 1e-6)];
}

/** Fill color for vertex data: white carrier with opacity when a gradient is used. */
export function whiteCarrier(opacity = 1, fillOpacity = 1): RGBA {
  return [1, 1, 1, opacity * fillOpacity];
}

/**
 * Accumulates the vertex data of consecutive items that share one pipeline
 * so a whole mark renders as a single buffer and draw call. Data is appended
 * in paint order (fill then stroke, item by item), preserving canvas
 * rendering semantics for overlapping items.
 */
export class GeometryBatch {
  private chunks: Float32Array[] = [];
  private total = 0;

  push(data: Float32Array): void {
    if (data.length > 0) {
      this.chunks.push(data);
      this.total += data.length;
    }
  }

  /** Concatenated data, or null when nothing was pushed. Resets the batch. */
  flush(): Float32Array | null {
    if (this.total === 0) {
      return null;
    }
    const out = new Float32Array(this.total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    this.total = 0;
    return out;
  }
}
