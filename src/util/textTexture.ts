import { Bounds, Marks } from 'vega-scenegraph';
import type { GPUVegaCanvasContext } from '../types/context.js';
import type { SceneTextItem } from '../types/scene.js';

const HALF_PI = Math.PI / 2;
const textMark = Marks.text;

export interface TextTexture {
  texture: GPUTexture;
  /** Physical (device-pixel) size of the texture. */
  physWidth: number;
  physHeight: number;
  /** Anchor position inside the texture, in device pixels (fractional). */
  anchorTexX: number;
  anchorTexY: number;
}

/**
 * Sub-pixel phases are quantized to this many steps per device pixel so the
 * glyph cache does not grow unbounded when the same string is drawn at many
 * fractional positions. 8 steps means at most 1/16 px of placement error, which is imperceptible.
 */
export const PHASE_STEPS = 8;

/** Quantized fractional part of `v`, in [0, 1), on the PHASE_STEPS grid. */
export function quantizePhase(v: number): number {
  const f = v - Math.floor(v);
  return Math.round(f * PHASE_STEPS) / PHASE_STEPS;
}

/** The point text is positioned around (x/y, offset by radius/theta). */
export function textAnchor(item: SceneTextItem): [number, number] {
  let x = item.x || 0;
  let y = item.y || 0;
  const r = item.radius || 0;
  if (r) {
    const t = (item.theta || 0) - HALF_PI;
    x += r * Math.cos(t);
    y += r * Math.sin(t);
  }
  return [x, y];
}

/**
 * Cache key over everything that affects the rasterized pixels (not opacity,
 * which the shader applies). `angle` is included because rotation is now baked
 * into the texture. `radius`/`theta` are not, because they only move the anchor
 * in scene space and cancel out of the anchor-relative offset.
 */
export function textCacheKey(item: SceneTextItem): string {
  const text = Array.isArray(item.text) ? item.text.join('') : String(item.text ?? '');
  return [
    text,
    item.font,
    item.fontSize,
    item.fontStyle,
    item.fontVariant,
    item.fontWeight,
    item.align,
    item.baseline,
    item.angle,
    item.dx,
    item.dy,
    item.fill,
    item.fillOpacity,
    item.stroke,
    item.strokeWidth,
    item.lineBreak,
    item.lineHeight,
    item.limit,
    item.ellipsis,
    item.dir,
  ].join('|');
}

/**
 * Rasterizes a text item into a GPU texture using vega-scenegraph's own canvas
 * text mark, so the pixels match the canvas renderer exactly. Two things are
 * baked in so the caller can place a plain, whole-device-pixel quad (crisp, no
 * resampling) that still lands exactly where canvas draws:
 *   - rotation, via the rotated bounding box (bound mode 0), and
 *   - the sub-pixel `phaseX`/`phaseY` (fractional device position of the
 *     anchor), so the glyph's antialiased edges align to the same device grid
 *     the canvas renderer uses. Only opacity is deferred (to the shader).
 */
export function rasterizeText(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  canvas: HTMLCanvasElement,
  c2d: CanvasRenderingContext2D,
  item: SceneTextItem,
  phaseX: number,
  phaseY: number,
): TextTexture | null {
  const dpi = ctx._uniforms.dpi || 1;
  const clone = { ...item, opacity: 1 };
  const b = textMark.bound(new Bounds(), clone, 0);
  const [ax, ay] = textAnchor(item);

  // Whole-pixel padding from the anchor to the top-left of the texture, with
  // at least 1px clearance so antialiased edges are never clipped. `anchorTex` is where
  // the anchor lands inside the texture. Its fractional part is the phase.
  const padLeft = Math.ceil(Math.max(0, (ax - b.x1) * dpi)) + 1;
  const padTop = Math.ceil(Math.max(0, (ay - b.y1) * dpi)) + 1;
  const anchorTexX = padLeft + phaseX;
  const anchorTexY = padTop + phaseY;
  const physWidth = Math.ceil(anchorTexX + (b.x2 - ax) * dpi) + 1;
  const physHeight = Math.ceil(anchorTexY + (b.y2 - ay) * dpi) + 1;
  if (physWidth <= 0 || physHeight <= 0) {
    return null;
  }

  canvas.width = physWidth;
  canvas.height = physHeight;
  // Map scene coords to texture device pixels: s becomes anchorTex + (s - anchor) * dpi.
  c2d.setTransform(dpi, 0, 0, dpi, anchorTexX - dpi * ax, anchorTexY - dpi * ay);
  textMark.draw(c2d, { items: [clone] }, null);

  const texture = device.createTexture({
    label: 'Text Texture',
    size: [physWidth, physHeight, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [physWidth, physHeight]);

  return { texture, physWidth, physHeight, anchorTexX, anchorTexY };
}
