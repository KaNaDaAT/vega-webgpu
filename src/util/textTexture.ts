import { Bounds, Marks } from 'vega-scenegraph';
import type { GPUVegaCanvasContext } from '../types/context.js';
import type { SceneTextItem } from '../types/scene.js';
import { joinStyleOf } from './join.js';

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
 * A paint as a key. A gradient is an object and every object stringifies the
 * same way, so joining one straight into the key made every gradient on text
 * collide: two labels with different gradients shared a raster, and the second
 * took the first one's colours.
 */
function paintKey(paint: unknown): string {
  return paint !== null && typeof paint === 'object' ? JSON.stringify(paint) : String(paint);
}

/**
 * Cache key over everything that affects the rasterized pixels (not opacity,
 * which the shader applies). `radius`/`theta` are not included, because they
 * only move the anchor in scene space and cancel out of the anchor-relative
 * offset. `angle` is, and is zero for a glyph the quad will turn instead.
 *
 * A label is rasterized by vega's own canvas text mark, so everything its
 * stroke helper sets belongs here: the dash, its offset, the cap, the join and
 * the miter limit all change the glyph pixels, and the join and the limit
 * change the cell size `strokeReach` asks for as well.
 */
export function textCacheKey(item: SceneTextItem): string {
  // vega draws an array as one line per entry and a string as one line, so
  // an array and its concatenation are two different pictures. Joined with
  // nothing they were one key and the second label reused the first raster.
  const text = Array.isArray(item.text) ? JSON.stringify(item.text) : String(item.text ?? '');
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
    paintKey(item.fill),
    item.fillOpacity,
    paintKey(item.stroke),
    item.strokeOpacity,
    item.strokeWidth,
    item.strokeCap,
    item.strokeJoin,
    item.strokeMiterLimit,
    String(item.strokeDash),
    item.strokeDashOffset,
    item.lineBreak,
    item.lineHeight,
    item.limit,
    item.ellipsis,
    item.dir,
  ].join('|');
}

/**
 * How far a stroke reaches past the glyph outline, in whole device pixels.
 *
 * A miter runs out to `miterLimit * width / 2` at a sharp enough corner, which
 * is where canvas clamps it. Any other join stays inside half the width.
 */
function glyphStrokePad(raster: SceneTextItem, dpi: number): number {
  if (!raster.stroke) {
    return 0;
  }
  const half = (raster.strokeWidth ?? 1) / 2;
  const { style, miterLimit } = joinStyleOf(raster);
  return Math.ceil(half * (style === 'miter' ? Math.max(miterLimit, 1) : 1) * dpi);
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

  // vega's text bound is the fill glyph box, since textMetrics reports an
  // advance and a height and neither knows about a stroke, so a cell sized
  // from it cuts the stroke off. Half the width is not the reach either: a
  // glyph corner under a miter join carries out to miterLimit * width / 2,
  // which is the bound canvas itself clamps to and the one geometryForItem
  // pads by. Whole device pixels, so the anchor rounds the way it did.
  const strokePad = glyphStrokePad(raster, dpi);
  // At least 1px clearance so antialiased edges are never clipped.
  const padLeft = Math.ceil(Math.max(0, (ax - b.x1) * dpi)) + 1 + strokePad;
  const padTop = Math.ceil(Math.max(0, (ay - b.y1) * dpi)) + 1 + strokePad;
  const [anchorTexX, anchorTexY] = anchorOffset((ax - vb.x1) * dpi, (ay - vb.y1) * dpi, padLeft, padTop, turn);
  const physWidth = Math.ceil(anchorTexX + (b.x2 - ax) * dpi) + 1 + strokePad;
  const physHeight = Math.ceil(anchorTexY + (b.y2 - ay) * dpi) + 1 + strokePad;
  if (physWidth <= 0 || physHeight <= 0) {
    return null;
  }
  return { physWidth, physHeight, anchorTexX, anchorTexY };
}

/**
 * How far canvas's own matrix has drifted where this label draws, in device
 * pixels. Zero unless `canvasTextDrift` is on: see util/canvasDrift.ts.
 */
export type Drift = readonly [dx: number, dy: number];

export const NO_DRIFT: Drift = [0, 0];

/** How near a half pixel a baseline has to be for canvas to disagree with us. */
const TIE_WINDOW = 1e-3;

/**
 * Whole device pixels the canvas renderer would put this label away from where
 * its own coordinates say, which is 0 unless its baseline sits on a half pixel.
 *
 * Two things move it, and both are canvas arithmetic rather than geometry. Its
 * matrix has drifted (see util/canvasDrift.ts), and it is a float32 matrix, so
 * a baseline our double puts at 157.49999999999994 is exactly 157.5 to it and
 * rounds the other way. Both are reproduced by computing the baseline the way
 * canvas does and comparing which whole pixel each lands on.
 *
 * The shift is kept apart from the sub-pixel phase on purpose. It is the only
 * thing that can move a label, and folding the difference into the phase
 * instead re-rasterizes labels it cannot move: a re-rasterization at a
 * hair-different phase can still flip a hinted stem, and every axis label in
 * `scatter-brush-panzoom` went to worst channel 255 that way. Rotated labels
 * are left exact, since the snap this crosses is the upright one.
 */
export function driftShift(
  ctx: GPUVegaCanvasContext,
  item: SceneTextItem,
  vb: Bounds,
  turn: Turn,
  translation: number | undefined,
): Drift {
  if (turn !== NO_TURN || translation === undefined) {
    return NO_DRIFT;
  }
  const dpi = ctx._uniforms.dpi || 1;
  const local = textAnchor(item)[1];
  const ours = (local - vb.y1) * dpi;
  // Only a baseline on the half pixel has anything to decide, and holding the
  // rest to exactly what they were is what keeps this from touching labels it
  // cannot move. The window covers the drift and the float32 step both.
  if (Math.abs(ours - Math.floor(ours) - 0.5) > TIE_WINDOW) {
    return NO_DRIFT;
  }
  // Both sides narrow to float32 before the snap, because that is what the
  // quad does on its way to the gpu. Narrowing one and not the other is what
  // left `Wicker Park` behind: its baseline is 146.49999999999994, which reads
  // as 146 in double and as exactly 146.5, so 147, once narrowed. The model
  // compared 146 against a drifted 146 and moved nothing while the label sat a
  // row below canvas. Narrowed the same way they agree when there is no drift
  // and differ by the row when there is.
  const theirs = translation + local * dpi;
  return [0, Math.round(Math.fround(theirs)) - Math.round(Math.fround(ours))];
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
 *
 * An upright label keeps its vertical phase exactly. The browser positions a
 * glyph sub-pixel across the baseline and snaps it to a whole pixel along it,
 * so a phase quantized onto a grid can land the other side of that snap from
 * where canvas put it, which moves the whole label a pixel. The snapping is
 * also why the finer key costs nothing: every phase on one side of it
 * rasterizes to the same glyph.
 */
function anchorOffset(px: number, py: number, padLeft: number, padTop: number, [c, s]: Turn): [number, number] {
  const nx = Math.round(px - (c * padLeft - s * padTop));
  const ny = Math.round(py - (s * padLeft + c * padTop));
  const dx = px - nx;
  const dy = py - ny;
  if (s === 0 && c === 1) {
    return [quantize(dx), dy];
  }
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
  // the blend is the composite's, and vega would set it on the atlas context
  textMark.draw(c2d, { items: [{ ...raster, opacity: 1, blend: undefined }] }, null);
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
