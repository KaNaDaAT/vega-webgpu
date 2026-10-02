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

/** Channels 0 to 255, alpha 0 to 1. */
export type CssColor = [r: number, g: number, b: number, a: number];

let probe: CanvasRenderingContext2D | null | undefined;
const cssCache = new Map<string, CssColor | null>();

/**
 * A colour as canvas parses it, or null when it does not. d3-color sets the
 * channels of a colour at zero alpha to NaN, and a gradient interpolates
 * through them, so a stop like rgba(255,0,0,0) fades from red on canvas.
 */
export function cssColor(value: string): CssColor | null {
  let parsed = cssCache.get(value);
  if (parsed === undefined) {
    parsed = parseCss(value);
    cssCache.set(value, parsed);
  }
  return parsed;
}

function parseCss(value: string): CssColor | null {
  probe ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (probe) {
    // an invalid colour leaves fillStyle as it was, so two starting points differ
    probe.fillStyle = '#000000';
    probe.fillStyle = value;
    const read = String(probe.fillStyle);
    probe.fillStyle = '#ffffff';
    probe.fillStyle = value;
    if (String(probe.fillStyle) !== read) {
      return null;
    }
    const css = readCss(read);
    if (css) {
      return css;
    }
  }
  const c = parseColor(value)?.rgb();
  return c ? [c.r, c.g, c.b, c.opacity] : null;
}

/** The two forms canvas serializes an sRGB colour in. */
function readCss(s: string): CssColor | null {
  if (/^#[0-9a-f]{6}$/i.test(s)) {
    return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
  }
  const rgba = /^rgba?\(([^)]*)\)$/.exec(s);
  if (!rgba) {
    return null;
  }
  const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
  return [r, g, b, a].every(Number.isFinite) ? [r, g, b, a] : null;
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
        console.warn('[vega-webgpu] A gradient on an item without bounds is drawn as a flat colour.');
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
