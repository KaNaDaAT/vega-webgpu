/**
 * Vega's `blend` maps onto canvas `globalCompositeOperation`. WebGPU has fixed
 * function blending rather than a programmable one, so only the modes that fall
 * out of its factors and operations can be honoured: multiply, screen, darken
 * and lighten. The rest (overlay, difference, hue and friends) need the
 * destination inside the shader, which WebGPU cannot do without a copy.
 *
 * These are exact for an opaque mark, which is what a blend is nearly always
 * used on. Blending a translucent mark also needs the source weighted by its
 * own alpha, and one set of factors cannot express both.
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

const warned = new Set<string>();

/** Normalizes a mark's blend to one this renderer keys a pipeline by. */
export function blendKey(blend: string | null | undefined): string {
  if (!blend || blend === 'source-over') {
    return 'normal';
  }
  if (Object.hasOwn(SUPPORTED, blend)) {
    return blend;
  }
  if (!warned.has(blend)) {
    warned.add(blend);
    console.warn(
      `[vega-webgpu] Blend mode '${blend}' needs the destination in the shader, which WebGPU cannot ` +
        `provide; drawing it normally. multiply, screen, darken and lighten are supported.`,
    );
  }
  return 'normal';
}

export function blendState(key: string): GPUBlendState {
  return SUPPORTED[key] ?? NORMAL;
}
