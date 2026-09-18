import { BLEND_MODES } from '../shaders/blendComposite.js';

/**
 * Vega's `blend` maps onto canvas `globalCompositeOperation`. Four of them fall
 * out of WebGPU's blend factors and operations, and those are the fast path:
 * multiply, screen, darken and lighten, drawn straight into the frame.
 *
 * Every other mode, and those four wherever their algebra does not fold, are
 * evaluated in a shader against a copy of the frame instead. See
 * `needsBackdrop` and shaders/blendComposite.ts.
 */
const NORMAL: GPUBlendState = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

const ALPHA: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };

const SUPPORTED: Record<string, GPUBlendState> = {
  // src * dst
  multiply: { color: { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: ALPHA },
  // src + dst * (1 - src)
  screen: { color: { srcFactor: 'one', dstFactor: 'one-minus-src', operation: 'add' }, alpha: ALPHA },
  darken: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'min' }, alpha: ALPHA },
  lighten: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' }, alpha: ALPHA },
};

/**
 * Modes whose factors cannot also weight the source by its own alpha.
 *
 * multiply and screen fold exactly at any alpha, since their factors expand to
 * the formula canvas uses. min and max have no term to interpolate with, so
 * darken and lighten are right only where the source covers the pixel outright,
 * which leaves out every antialiased edge as well as every translucent mark.
 * Those are drawn into a layer and composited against a copy of the frame.
 */
const NEEDS_BACKDROP = new Set(['darken', 'lighten']);

/** Everything the composite can evaluate, which is everything canvas has. */
const EVALUATED = new Set(BLEND_MODES);

/**
 * True when the mode has to be evaluated in a shader against a copy of the
 * frame rather than left to the blend state.
 *
 * multiply and screen fold only against an opaque backdrop. The full formula
 * also carries the source over the part of the pixel the backdrop does not
 * cover, and factors that reach the destination cannot carry that as well: a
 * multiply over nothing came out black where canvas draws the source plainly.
 * A frame cleared opaque stays opaque wherever anything draws, since source
 * over leaves the alpha at one, so there the shortcut is exact.
 */
export function needsBackdrop(key: string, opaqueBackdrop: boolean): boolean {
  if (key === 'normal') {
    return false;
  }
  return !opaqueBackdrop || NEEDS_BACKDROP.has(key) || !Object.hasOwn(SUPPORTED, key);
}

/** Replaces the pixel, for a composite that has already done the blending. */
export const REPLACE: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
};

/**
 * The mode a pipeline was asked for, where that mode is evaluated in a shader.
 * Such a pipeline is built to draw unblended, so what it is for is recorded
 * here rather than readable from it, and the queue routes its draws into a
 * layer and folds them back with `blendCompositeElement`.
 */
const layerModes = new WeakMap<GPURenderPipeline, string>();

function rememberLayerMode(pipeline: GPURenderPipeline, mode: string): void {
  layerModes.set(pipeline, mode);
}

/**
 * The mode to build a pipeline with, given the one it was asked for. A mode the
 * blend state cannot express builds unblended, and `record` then ties the
 * pipeline back to what it stands in for so the queue can lift its draws into a
 * layer. Every pipeline that carries a blend goes through this.
 */
export function buildBlend(
  blend: string,
  opaqueBackdrop: boolean,
): { blend: string; record: (pipeline: GPURenderPipeline) => void } {
  if (!needsBackdrop(blend, opaqueBackdrop)) {
    return { blend, record: () => {} };
  }
  return { blend: 'normal', record: pipeline => rememberLayerMode(pipeline, blend) };
}

/** The mode a pipeline's draws are composited with, or undefined for the frame. */
export function layerMode(pipeline: GPURenderPipeline): string | undefined {
  return layerModes.get(pipeline);
}

const warned = new Set<string>();

/** Normalizes a mark's blend to one this renderer keys a pipeline by. */
export function blendKey(blend: string | null | undefined): string {
  // vega writes the default either way round, so neither is a mode we lack
  if (!blend || blend === 'normal' || blend === 'source-over') {
    return 'normal';
  }
  if (EVALUATED.has(blend)) {
    return blend;
  }
  if (!warned.has(blend)) {
    warned.add(blend);
    console.warn(`[vega-webgpu] Blend mode '${blend}' is not one canvas has; drawing it normally.`);
  }
  return 'normal';
}

export function blendState(key: string): GPUBlendState {
  return SUPPORTED[key] ?? NORMAL;
}
