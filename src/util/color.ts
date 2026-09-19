import { color as parseColor } from 'd3-color';
import type { SceneColor, SceneGradient } from '../types/scene.js';

export type RGBA = [r: number, g: number, b: number, a: number];

const TRANSPARENT: RGBA = [0, 0, 0, 0];
/** Placeholder for gradients on paths that cannot sample a ramp (strokes). */
const GRADIENT_FALLBACK: RGBA = [0.5, 1.0, 1.0, 1.0];

let warnedGradient = false;
let warnedInvalid = false;

export function isGradient(value: SceneColor | null | undefined): value is SceneGradient {
  return typeof value === 'object' && value !== null && ('gradient' in value || 'id' in value);
}

/** Parses a CSS color string to premultiplication-ready normalized RGBA. */
function parse(value: string): RGBA {
  const c = parseColor(value);
  if (c === null) {
    if (!warnedInvalid) {
      warnedInvalid = true;
      console.warn(`[vega-webgpu] Could not parse color '${value}'.`);
    }
    return TRANSPARENT;
  }
  const rgb = c.rgb();
  // d3 gives a fully transparent colour NaN channels, whatever was written, and
  // those reach a clear value and a vertex buffer exactly as they are: a spec
  // with a transparent background failed the frame outright.
  return [channel(rgb.r), channel(rgb.g), channel(rgb.b), Number.isFinite(rgb.opacity) ? rgb.opacity : 0];
}

function channel(value: number): number {
  return Number.isFinite(value) ? value / 255 : 0;
}

export class Color {
  private static cache: Record<string, RGBA> = {};

  /** The colour's unscaled rgba, cached per string. */
  private static resolve(value: SceneColor | null | undefined): RGBA {
    if (value == null || value === 'transparent') {
      return TRANSPARENT;
    }
    if (isGradient(value)) {
      if (!warnedGradient) {
        warnedGradient = true;
        console.warn('[vega-webgpu] A gradient stroke is only sampled where the mark triangulates it.');
      }
      return GRADIENT_FALLBACK;
    }
    let rgba = Color.cache[value];
    if (rgba === undefined) {
      rgba = parse(value);
      Color.cache[value] = rgba;
    }
    return rgba;
  }

  /**
   * A scenegraph colour as normalized rgba, with the item's opacity and its
   * fill or stroke opacity applied. Unset becomes transparent.
   */
  static from(value: SceneColor | null | undefined, opacity = 1.0, fsOpacity = 1.0): RGBA {
    const [r, g, b, a] = Color.resolve(value);
    return [r, g, b, a * opacity * fsOpacity];
  }

  /**
   * Writes the colour straight into `out` at `index`, which is what a per item
   * attribute loop wants: `from` allocates a fresh array on every call, and a
   * mark resolves a fill and a stroke for each of its items on every frame.
   */
  static write(
    out: Float32Array,
    index: number,
    value: SceneColor | null | undefined,
    opacity = 1.0,
    fsOpacity = 1.0,
  ): void {
    const rgba = Color.resolve(value);
    out[index] = rgba[0];
    out[index + 1] = rgba[1];
    out[index + 2] = rgba[2];
    out[index + 3] = rgba[3] * opacity * fsOpacity;
  }
}
