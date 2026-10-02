import type { Point } from '../types/geometry.js';
import { samePoint } from './dash.js';

/**
 * What a segment does at one of its ends: a kind, plus the direction and length
 * that kind needs.
 *
 * `m` is a unit direction and `cut` a length along it, and which of the two a
 * kind uses is in the table below. Both were once inferred from whether `m` was
 * zero and what sign `cut` had, which ran out of combinations at six, so the
 * kind is its own field now.
 *
 * Two segments meeting at a vertex carry the same bisector and each keeps its
 * own side of it, so their union is the joined outline and neither draws over
 * the other. Where one of them is too short to reach that far, the other keeps
 * the rest. See `reach` in marks/util.ts.
 */
export type JoinEnd = readonly [mx: number, my: number, cut: number, kind: number];

/** Flat at the end point, which is canvas's default cap. */
export const KIND_BUTT = 0;
/** A half disc of the stroke's own width, for `strokeCap: 'round'`. */
export const KIND_ROUND_CAP = 1;
/** Cut against the bisector and rounded off at the end point. */
export const KIND_ROUND_JOIN = 2;
/** Cut against the bisector, with the axis running on to the corner's own apex. */
export const KIND_MITER = 3;
/** The same, clipped at `cut` along the bisector where the limit bites. */
export const KIND_BEVEL = 4;
/** Rounded off and cut back toward the end it faces, `cut` being half the way. */
export const KIND_CAP_MEET = 5;
export const BUTT_END: JoinEnd = [0, 0, 0, KIND_BUTT];
export const ROUND_END: JoinEnd = [0, 0, 0, KIND_ROUND_CAP];

/** What canvas uses when the item sets neither. */
export const DEFAULT_MITER_LIMIT = 10;

/** The join and limit of an item, defaulted the way vega's canvas renderer does. */
export function joinStyleOf(item: { strokeJoin?: string; strokeMiterLimit?: number }): {
  style: string;
  miterLimit: number;
} {
  return { style: item.strokeJoin || 'miter', miterLimit: item.strokeMiterLimit || DEFAULT_MITER_LIMIT };
}

/**
 * The join at `at`, between the segment arriving from `prev` and the one
 * leaving towards `next`, written as four floats at `out[i]`.
 *
 * Writing in place rather than returning: a stroked choropleth joins hundreds
 * of thousands of vertices a frame, and a tuple each would be that many
 * allocations.
 *
 */
export function writeJoin(
  out: Float32Array,
  i: number,
  prev: Point,
  at: Point,
  next: Point,
  halfWidth: number,
  style: string,
  miterLimit: number,
): void {
  const d1x = at[0] - prev[0];
  const d1y = at[1] - prev[1];
  const d2x = next[0] - at[0];
  const d2y = next[1] - at[1];
  const l1 = Math.hypot(d1x, d1y);
  const l2 = Math.hypot(d2x, d2y);
  if (l1 < 1e-9 || l2 < 1e-9) {
    writeEnd(out, i, BUTT_END);
    return;
  }
  const ax = d1x / l1;
  const ay = d1y / l1;
  const bx = d2x / l2;
  const by = d2y / l2;
  // the exterior bisector, which points at the outside of the turn
  let mx = ax - bx;
  let my = ay - by;
  const ml = Math.hypot(mx, my);
  if (ml < 1e-9) {
    // collinear, so the flat cut is already exact and there is no corner
    writeEnd(out, i, BUTT_END);
    return;
  }
  mx /= ml;
  my /= ml;
  out[i] = mx;
  out[i + 1] = my;
  if (style === 'round') {
    out[i + 2] = 0;
    out[i + 3] = KIND_ROUND_JOIN;
    return;
  }
  // cosine of the half angle, as the bisector against the arriving normal
  const cos = Math.abs(mx * -ay + my * ax);
  const miter = cos > 1e-6 ? 1 / cos : Infinity;
  const bevelled = style === 'bevel' || miter > miterLimit;
  out[i + 2] = bevelled ? Math.max(halfWidth * cos, 1e-4) : halfWidth * miter;
  out[i + 3] = bevelled ? KIND_BEVEL : KIND_MITER;
}

/** Writes a fixed end, for a cap or a vertex with no join. */
export function writeEnd(out: Float32Array, i: number, end: JoinEnd): void {
  out[i] = end[0];
  out[i + 1] = end[1];
  out[i + 2] = end[2];
  out[i + 3] = end[3];
}

/** The cap style of an item, as the end both outer ends of its runs take. */
export function capEnd(strokeCap: string | undefined): JoinEnd {
  return strokeCap === 'round' ? ROUND_END : BUTT_END;
}

/** True when a run returns to where it started, so its seam is a join. */
export function isLoop(run: readonly Point[]): boolean {
  return run.length > 2 && samePoint(run[0], run[run.length - 1]);
}
