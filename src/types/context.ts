import type { TextDrift } from '../util/canvasDrift.js';
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
  /** Cache triangulated shape geometry between frames (experimental). */
  cacheShapes: boolean;
  /**
   * Place a label where the canvas renderer puts it rather than where its own
   * coordinates say, when the two disagree.
   *
   * They disagree on a baseline landing exactly on a half device pixel, which
   * canvas rounds up unless its matrix has drifted below it, and vega's canvas
   * renderer drifts it by translating to each item and back. See
   * util/canvasDrift.ts. Off by default: it reproduces another renderer's
   * rounding error, and the exact placement is the one a canvas without the
   * drift gives. On when a view has to sit beside a canvas one and match.
   */
  canvasTextDrift: boolean;
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
  /**
   * Follow browser zoom. Zoom changes devicePixelRatio, and the default
   * re-sizes the canvas and redraws so the view stays sharp. When false the
   * canvas keeps the ratio it was first sized at and the browser scales it,
   * which is softer but skips the redraw and cannot grow past the texture cap.
   */
  redrawOnZoom: boolean;
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
  /** Per text mark, canvas's own matrix drift, when wgOptions asks for it. */
  _textDrift?: TextDrift | null;
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
  /**
   * Whether the frame was cleared to an opaque colour. Source over leaves the
   * alpha at one, so a frame that starts opaque is opaque wherever anything
   * draws, and a blend can then be left to the blend state. See util/blend.ts.
   */
  _opaqueBackdrop: boolean;

  /** Compiled shader sources, keyed by builder name, sub-variant and blend mode. */
  _shaderCache: Record<string, GPUShaderModule>;
  /**
   * Compiled pipelines, keyed by everything that defines one. Creating them is
   * the bulk of a first frame, and marks with the same shader and layout would
   * otherwise each compile their own.
   */
  _pipelineCache: Record<string, GPURenderPipeline>;
  /** Per-mark GPU resources (pipelines, buffers), keyed by mark type. */
  _markCache: Record<string, unknown>;

  _pathCache: Record<string, PathGeometry>;
  _pathCacheSize: number;
  _geometryCache: Record<string, ItemGeometry>;
  _geometryCacheSize: number;

  /** Adds random depth jitter to path geometry (unused by default). */
  _randomZ?: boolean;
};
