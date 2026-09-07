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
  return [rgb.r / 255, rgb.g / 255, rgb.b / 255, rgb.opacity];
}

export class Color {
  private static cache: Record<string, RGBA> = {};

  private values: RGBA;

  constructor(r: number, g: number, b: number, a = 1) {
    this.values = [r, g, b, a];
  }

  /**
   * Converts a scenegraph color value into a Color, applying the item's
   * opacity and fill/stroke opacity. Unset values become transparent.
   */
  static from(value: SceneColor | Color | null | undefined, opacity = 1.0, fsOpacity = 1.0): Color {
    const [r, g, b, a] = Color.from2(value, opacity, fsOpacity);
    return new Color(r, g, b, a);
  }

  /**
   * Same as `from`, returning a plain RGBA tuple. Parses through a cache
   * keyed by the color string. Opacity is applied after cache lookup.
   */
  /**
   * Writes the colour straight into `out` at `index`, which is what a per item
   * attribute loop wants: from2 allocates a fresh array on every call, and a
   * mark resolves a fill and a stroke for each of its items on every frame.
   */
  static write(
    out: Float32Array,
    index: number,
    value: SceneColor | Color | null | undefined,
    opacity = 1.0,
    fsOpacity = 1.0,
  ): void {
    if (value instanceof Color) {
      out[index] = value.values[0];
      out[index + 1] = value.values[1];
      out[index + 2] = value.values[2];
      out[index + 3] = value.values[3];
      return;
    }
    const rgba = Color.resolve(value);
    out[index] = rgba[0];
    out[index + 1] = rgba[1];
    out[index + 2] = rgba[2];
    out[index + 3] = rgba[3] * opacity * fsOpacity;
  }

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

  static from2(value: SceneColor | Color | null | undefined, opacity = 1.0, fsOpacity = 1.0): RGBA {
    if (value == null) {
      return TRANSPARENT;
    }
    if (value instanceof Color) {
      return [value.r, value.g, value.b, value.a];
    }
    if (value === 'transparent') {
      return TRANSPARENT;
    }
    if (isGradient(value)) {
      if (!warnedGradient) {
        warnedGradient = true;
        console.warn('[vega-webgpu] Gradient strokes are not supported, drawing a placeholder color.');
      }
      const [r, g, b, a] = GRADIENT_FALLBACK;
      return [r, g, b, a * opacity * fsOpacity];
    }

    let rgba = Color.cache[value];
    if (rgba === undefined) {
      rgba = parse(value);
      Color.cache[value] = rgba;
    }
    return [rgba[0], rgba[1], rgba[2], rgba[3] * opacity * fsOpacity];
  }

  *[Symbol.iterator](): Generator<number> {
    yield* this.values;
  }

  get rgba(): RGBA {
    return [this.values[0], this.values[1], this.values[2], this.values[3]];
  }

  get r(): number {
    return this.values[0];
  }

  get g(): number {
    return this.values[1];
  }

  get b(): number {
    return this.values[2];
  }

  get a(): number {
    return this.values[3];
  }

  get 0(): number {
    return this.values[0];
  }

  get 1(): number {
    return this.values[1];
  }

  get 2(): number {
    return this.values[2];
  }

  get 3(): number {
    return this.values[3];
  }
}
