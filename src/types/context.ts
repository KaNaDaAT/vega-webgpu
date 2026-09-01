import type { Bounds } from 'vega-scenegraph';
import type WebGPURenderer from '../WebGPURenderer.js';
import type { RenderQueue } from '../util/renderQueue.js';
import type { ItemGeometry, PathGeometry } from './geometry.js';
import type { SceneGroupExt, SceneItem } from './scene.js';

/** Scissor rectangle in physical (device) pixels: x, y, width, height. */
export type ClipRect = [x: number, y: number, width: number, height: number];

export interface RenderUniforms {
  resolution: [width: number, height: number];
  origin: readonly [x: number, y: number];
  dpi: number;
}

/** Renderer options adjustable via `view._renderer.wgOptions`. */
export interface GPUVegaOptions {
  /** Render marks in batches where possible (e.g. many lines at once). */
  renderBatch: boolean;
  /** @deprecated since 1.2.0, superseded by renderBatch. */
  simpleLine: boolean;
  /** Cache triangulated shape geometry between frames (experimental). */
  cacheShapes: boolean;
  /** Log per-frame render timings to the console. */
  debugLog: boolean;
  /** Skip re-entrant render calls; always re-runs the most recent request. */
  renderLock: boolean;
  /**
   * Renders into a texture the renderer owns and never touches the canvas
   * swapchain. Needed where getCurrentTexture() is unavailable, e.g. a headless
   * runner with no compositor, where acquiring it destroys the device. The
   * canvas is left blank, so the frame is only reachable through captureFrame.
   */
  offscreen: boolean;
  /**
   * MSAA samples per pixel: 4 (antialiased, default) or 1 (plain
   * single-sampled rendering). Other values fall back to 4. Can be changed
   * between frames. Pipelines are rebuilt on the next render.
   */
  sampleCount: number;
}

/** A scenegraph mark node as passed to mark draw functions. */
export interface GPUVegaScene {
  marktype: string;
  name?: string;
  role?: string;
  interactive?: boolean;
  clip?: boolean;
  zindex?: number;
  bounds?: Bounds;
  items?: SceneItem[];
  group?: SceneGroupExt;
}

/**
 * The WebGPU canvas context, augmented with the per-renderer state the
 * mark implementations need. All GPU resources cached here are keyed to
 * one renderer instance, so multiple views on a page stay independent.
 */
export type GPUVegaCanvasContext = GPUCanvasContext & {
  /** Current group translation while walking the scenegraph. */
  _tx: number;
  _ty: number;
  /** Active scissor rect (physical pixels), if any. */
  _clip?: ClipRect;

  _renderer: WebGPURenderer;
  _renderQueue: RenderQueue;
  _uniforms: RenderUniforms;

  /** View origin in logical pixels (set on resize). */
  _origin: readonly [number, number];
  _ratio: number;
  /** Active MSAA sample count; mark pipelines must be created with it. */
  _sampleCount: number;

  _shaderCache: Record<string, GPUShaderModule>;
  /** Per-mark GPU resources (pipelines, buffers), keyed by mark type. */
  _markCache: Record<string, unknown>;

  _pathCache: Record<string, PathGeometry>;
  _pathCacheSize: number;
  _geometryCache: Record<string, ItemGeometry>;
  _geometryCacheSize: number;

  /** Adds random depth jitter to path geometry (unused by default). */
  _randomZ?: boolean;
};
