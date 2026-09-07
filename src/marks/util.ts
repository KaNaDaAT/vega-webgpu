import type { Bounds } from 'vega-scenegraph';
import type { BufferManager } from '../util/bufferManager.js';
import { dashPolyline, type Point } from '../util/dash.js';
import type { VertexBufferManager } from '../util/vertexManager.js';
import { createRenderPipeline, preferredColorFormat } from '../util/webgpu.js';
import type { ClipRect, GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { ItemGeometry } from '../types/geometry.js';
import type { SceneRectExt } from '../types/scene.js';
import { Color, type RGBA } from '../util/color.js';
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
  vb: Bounds | undefined,
  create: () => T,
): T {
  const cached = ctx._markCache[markType] as T | undefined;
  const res = cached && cached.device === device ? cached : ((ctx._markCache[markType] = create()) as T);
  // Resources outlive the frame, so a cached BufferManager still holds the
  // previous frame's resolution and group offset. Refreshing here means a mark
  // cannot forget to, which would draw the whole mark at a stale offset.
  if (vb) {
    const buffers = (res as { bufferManager?: BufferManager }).bufferManager;
    buffers?.setResolution(ctx._uniforms.resolution);
    buffers?.setOffset([vb.x1, vb.y1]);
  }
  return res;
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

/**
 * Rect and group strokes are drawn analytically in the fragment shader, which
 * cannot express a dash pattern. When `strokeDash` is set the border is walked
 * as a closed polyline instead and emitted as single-segment line instances.
 * Returns null when the item has no dashed border to draw.
 */
/**
 * Builds a mark pipeline. The colour format and sample count must match the
 * frame's attachments, and getting either wrong silently breaks MSAA, so they
 * are filled in here rather than repeated at every call site.
 */
export function markPipeline(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  label: string,
  shaderKey: string,
  vertexManager: VertexBufferManager,
  fragmentEntryPoint?: string,
): GPURenderPipeline {
  const buffers = vertexManager.getBuffers();
  const key = `${shaderKey}|${fragmentEntryPoint ?? ''}|${ctx._sampleCount}|${JSON.stringify(buffers)}`;
  const cached = ctx._pipelineCache[key];
  if (cached) {
    return cached;
  }
  const pipeline = createRenderPipeline(
    label,
    device,
    ctx._shaderCache[shaderKey],
    preferredColorFormat(),
    ctx._sampleCount,
    buffers,
    undefined,
    fragmentEntryPoint,
  );
  ctx._pipelineCache[key] = pipeline;
  return pipeline;
}

/**
 * Vertex layout of a single line segment instance, shared by every mark that
 * falls back to the SLine shader: dashes, dashed borders and diagonal rules.
 */
export const SEGMENT_LAYOUT: GPUVertexFormat[] = ['float32x2', 'float32x2', 'float32x4', 'float32'];

/** Packs one segment as start, end, colour, width. */
export function segmentInstance(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: RGBA,
  width: number,
): Float32Array {
  return Float32Array.from([x1, y1, x2, y2, ...color, width]);
}

/** Packs every segment of every polyline, or null when there is nothing to draw. */
export function segmentInstances(runs: Point[][], color: RGBA, width: number): Float32Array | null {
  const count = runs.reduce((n, r) => n + Math.max(0, r.length - 1), 0);
  if (count === 0) {
    return null;
  }
  const data = new Float32Array(count * SEGMENT_STRIDE);
  let i = 0;
  for (const run of runs) {
    for (let s = 0; s < run.length - 1; s++) {
      data.set([run[s][0], run[s][1], run[s + 1][0], run[s + 1][1], ...color, width], i);
      i += SEGMENT_STRIDE;
    }
  }
  return data;
}

/** Floats per segment instance: start, end, colour, width. */
export const SEGMENT_STRIDE = 9;

/**
 * Rect and group strokes are drawn analytically in the fragment shader, which
 * cannot express a dash pattern. When `strokeDash` is set the border is walked
 * as a closed polyline instead and emitted as single-segment line instances.
 * Returns null when the item has no dashed border to draw.
 */
export function dashedBorderInstances(item: SceneRectExt): Float32Array | null {
  const pattern = Array.isArray(item.strokeDash) ? item.strokeDash : undefined;
  if (!pattern?.length || !item.stroke) {
    return null;
  }
  const x = item.x ?? 0;
  const y = item.y ?? 0;
  const w = item.width ?? 0;
  const h = item.height ?? 0;
  if (w <= 0 || h <= 0) {
    return null;
  }
  const border: Point[] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ];
  const runs = dashPolyline(border, pattern, item.strokeDashOffset ?? 0);
  const color = Color.from2(item.stroke, item.opacity, item.strokeOpacity);
  return segmentInstances(runs, color, item.strokeWidth ?? 1);
}

/**
 * Per-item geometry cache, shared by the marks that triangulate. Rebuilding the
 * vertex data every frame is what makes a re-render cost multiples of canvas,
 * and the geometry only changes when the item's position, size or path does.
 */
export interface CacheableItem {
  x?: number;
  y?: number;
  bounds?: Bounds;
  strokeWidth?: number;
  path?: string;
  datum?: { id?: unknown };
  id?: unknown;
}

type BoundsSnapshot = { x1: number; y1: number; x2: number; y2: number };

export interface GeometryCacheEntry {
  fill: RGBA;
  stroke: RGBA;
  x?: number;
  y?: number;
  bounds?: BoundsSnapshot;
  strokeWidth?: number;
  path?: string;
  data: [Float32Array, Float32Array];
}

export type GeometryCache = Map<unknown, GeometryCacheEntry>;

// Bounds the cache so a streaming session, where every frame brings new datum
// ids, cannot grow it without limit.
const MAX_GEOMETRY_CACHE = 4096;

/** Identifies an item across frames: vega keeps tuple ids on a symbol. */
function cacheKey(item: CacheableItem): unknown {
  if (item.datum?.id != null) {
    return item.datum.id;
  }
  if (item.id != null) {
    return item.id;
  }
  const symbols = Object.getOwnPropertySymbols(item);
  return symbols.length > 0 ? (item as unknown as Record<symbol, unknown>)[symbols[0]] : item;
}

/**
 * Vega mutates a Bounds in place as the view pans or zooms, so comparing by
 * identity never sees a change. Snapshot the numbers and compare those.
 */
function copyBounds(b?: Bounds): BoundsSnapshot | undefined {
  return b ? { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 } : undefined;
}

function sameBounds(b: Bounds | undefined, snap: BoundsSnapshot | undefined): boolean {
  if (!b || !snap) {
    return b === undefined && snap === undefined;
  }
  return b.x1 === snap.x1 && b.y1 === snap.y1 && b.x2 === snap.x2 && b.y2 === snap.y2;
}

function sameColor(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Copies positions from `source` and writes `color` into every vertex. */
function recolor(data: Float32Array, source: Float32Array, color: RGBA): void {
  for (let i = 0; i < data.length; i += 7) {
    data[i] = source[i];
    data[i + 1] = source[i + 1];
    data[i + 2] = source[i + 2];
    data[i + 3] = color[0];
    data[i + 4] = color[1];
    data[i + 5] = color[2];
    data[i + 6] = color[3];
  }
}

/**
 * Returns the item's vertex data, building it only when the geometry changed.
 * A colour-only change rewrites the colours over the cached positions instead
 * of triangulating again.
 */
export function cachedGeometryData(
  cache: GeometryCache,
  item: CacheableItem,
  fill: RGBA,
  stroke: RGBA,
  build: () => [Float32Array, Float32Array],
): [Float32Array, Float32Array] {
  const key = cacheKey(item);
  const entry = cache.get(key);
  if (
    entry &&
    item.strokeWidth === entry.strokeWidth &&
    item.x === entry.x &&
    item.y === entry.y &&
    item.path === entry.path &&
    sameBounds(item.bounds, entry.bounds)
  ) {
    // re-insert to keep the map in least-recently-used order
    cache.delete(key);
    cache.set(key, entry);
    if (sameColor(entry.fill, fill) && sameColor(entry.stroke, stroke)) {
      return entry.data;
    }
    const data: [Float32Array, Float32Array] = [
      new Float32Array(entry.data[0].length),
      new Float32Array(entry.data[1].length),
    ];
    recolor(data[0], entry.data[0], fill);
    recolor(data[1], entry.data[1], stroke);
    return data;
  }

  const data = build();
  if (cache.size >= MAX_GEOMETRY_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, {
    fill,
    stroke,
    x: item.x,
    y: item.y,
    bounds: copyBounds(item.bounds),
    strokeWidth: item.strokeWidth,
    path: item.path,
    data,
  });
  return data;
}
