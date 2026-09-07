import { Bounds, Marks } from 'vega-scenegraph';
import type { GPUVegaCanvasContext } from '../types/context.js';
import type { SceneTextItem } from '../types/scene.js';

const HALF_PI = Math.PI / 2;
const textMark = Marks.text;

/** Size of one rasterized label and where its anchor sits inside it. */
export interface GlyphMetrics {
  /** Physical (device-pixel) size of the rasterization. */
  physWidth: number;
  physHeight: number;
  /** Anchor position inside the rasterization, in device pixels (fractional). */
  anchorTexX: number;
  anchorTexY: number;
}

export interface TextTexture extends GlyphMetrics {
  texture: GPUTexture;
}

/**
 * Sub-pixel phases are quantized to this many steps per device pixel so the
 * glyph cache does not grow unbounded when the same string is drawn at many
 * fractional positions. At 8 steps a label could land in a different one of
 * skia's own subpixel buckets than canvas picked, which flips a whole stem
 * pixel: scales-discretize and panzoom were both 255 off on one. 64 costs
 * nothing on a static scene, since each label still has one phase, and only
 * churns the cache faster while text is moving.
 */
export const PHASE_STEPS = 64;

const DEG_TO_RAD = Math.PI / 180;

/** `v` snapped to the PHASE_STEPS grid, so the cache cannot grow unbounded. */
function quantize(v: number): number {
  return Math.round(v * PHASE_STEPS) / PHASE_STEPS;
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
 * which the shader applies). `radius`/`theta` are not included, because they
 * only move the anchor in scene space and cancel out of the anchor-relative
 * offset. `angle` is, and is zero for a glyph the quad will turn instead.
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
    item.strokeOpacity,
    item.strokeWidth,
    item.lineBreak,
    item.lineHeight,
    item.limit,
    item.ellipsis,
    item.dir,
  ].join('|');
}

/**
 * Size of `raster`'s rasterization and where its anchor sits inside it. The
 * anchor offset is picked so that turning the quad about the anchor puts the
 * glyph's top-left corner on a whole device pixel, which for a quarter turn
 * maps every texel onto exactly one pixel, and for no turn at all reproduces
 * what the canvas renderer rasterizes.
 */
export function glyphMetrics(
  ctx: GPUVegaCanvasContext,
  raster: SceneTextItem,
  vb: Bounds,
  turn: Turn,
): GlyphMetrics | null {
  const dpi = ctx._uniforms.dpi || 1;
  const b = textMark.bound(new Bounds(), raster, 0);
  const [ax, ay] = textAnchor(raster);

  // At least 1px clearance so antialiased edges are never clipped.
  const padLeft = Math.ceil(Math.max(0, (ax - b.x1) * dpi)) + 1;
  const padTop = Math.ceil(Math.max(0, (ay - b.y1) * dpi)) + 1;
  const [anchorTexX, anchorTexY] = anchorOffset((ax - vb.x1) * dpi, (ay - vb.y1) * dpi, padLeft, padTop, turn);
  const physWidth = Math.ceil(anchorTexX + (b.x2 - ax) * dpi) + 1;
  const physHeight = Math.ceil(anchorTexY + (b.y2 - ay) * dpi) + 1;
  if (physWidth <= 0 || physHeight <= 0) {
    return null;
  }
  return { physWidth, physHeight, anchorTexX, anchorTexY };
}

/** Cosine and sine of a label's angle. */
export type Turn = readonly [cos: number, sin: number];

export const NO_TURN: Turn = [1, 0];

/** Cosine and sine of an item's angle, which vega stores in degrees. */
export function turnOf(item: SceneTextItem): Turn {
  const a = (item.angle || 0) * DEG_TO_RAD;
  return a === 0 ? NO_TURN : [Math.cos(a), Math.sin(a)];
}

/**
 * Anchor offset inside the texture, in device pixels. The rotated corner sits
 * at `p - R * anchor`, so rounding that to a whole pixel and mapping back
 * through the inverse rotation gives the offset that lands it there.
 */
function anchorOffset(px: number, py: number, padLeft: number, padTop: number, [c, s]: Turn): [number, number] {
  const nx = Math.round(px - (c * padLeft - s * padTop));
  const ny = Math.round(py - (s * padLeft + c * padTop));
  const dx = px - nx;
  const dy = py - ny;
  return [quantize(c * dx + s * dy), quantize(-s * dx + c * dy)];
}

/**
 * The item with its rotation dropped, for a quad that will turn instead.
 *
 * Rasterizing the rotation in matches canvas at any angle, but every rotated
 * label a frame moves then has to be rasterized and read back out of a 2D
 * canvas, about 0.15 ms each: a radial tree spent 32 ms a frame there.
 */
export function upright(item: SceneTextItem): SceneTextItem {
  return { ...item, angle: 0 };
}

/**
 * Draws the label with vega-scenegraph's own canvas text mark, so the pixels
 * match the canvas renderer exactly, with its top-left at (originX, originY).
 */
export function drawGlyph(
  c2d: CanvasRenderingContext2D,
  dpi: number,
  raster: SceneTextItem,
  m: GlyphMetrics,
  originX: number,
  originY: number,
): void {
  const [ax, ay] = textAnchor(raster);
  c2d.setTransform(dpi, 0, 0, dpi, originX + m.anchorTexX - dpi * ax, originY + m.anchorTexY - dpi * ay);
  textMark.draw(c2d, { items: [{ ...raster, opacity: 1 }] }, null);
}

/**
 * A label too large for the atlas, rasterized into a texture of its own.
 *
 * Premultiplied, for the same reason as the image mark: converting a glyph's
 * antialiased edge to straight alpha turns its transparent side black and
 * filtering then darkens the edge. The shader divides the alpha back out.
 */
export function rasterizeText(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  c2d: CanvasRenderingContext2D,
  dpi: number,
  raster: SceneTextItem,
  m: GlyphMetrics,
): TextTexture {
  // Grow-only. Resizing a canvas recreates its backing store, which invalidates
  // the external image reference the GPU copy takes (an OperationError on Linux
  // Dawn). The glyph is drawn at the top-left and only that region is copied.
  if (canvas.width < m.physWidth || canvas.height < m.physHeight) {
    canvas.width = Math.max(canvas.width, m.physWidth);
    canvas.height = Math.max(canvas.height, m.physHeight);
  }
  c2d.setTransform(1, 0, 0, 1, 0, 0);
  c2d.clearRect(0, 0, canvas.width, canvas.height);
  drawGlyph(c2d, dpi, raster, m, 0, 0);

  const texture = device.createTexture({
    label: 'Text Texture',
    size: [m.physWidth, m.physHeight, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: canvas }, { texture, premultipliedAlpha: true }, [
    m.physWidth,
    m.physHeight,
  ]);

  return { texture, ...m };
}
