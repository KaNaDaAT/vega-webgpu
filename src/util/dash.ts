export type Point = [number, number];

/**
 * Splits a polyline into the drawn runs of a dash pattern, matching the canvas
 * setLineDash semantics: an odd-length pattern repeats to make it even, and the
 * offset skips into the pattern before the first point.
 *
 * Returns one polyline per drawn run, so callers can render them as ordinary
 * line segments.
 */
export function dashPolyline(points: Point[], pattern: number[], offset = 0): Point[][] {
  const dashes = normalizePattern(pattern);
  if (dashes === null || points.length < 2) {
    return points.length >= 2 ? [points] : [];
  }

  const total = dashes.reduce((a, b) => a + b, 0);
  let index = 0;
  let remaining = dashes[0];
  let on = true;

  // Wind the pattern forward by the offset before drawing anything.
  let skip = ((offset % total) + total) % total;
  while (skip > 0) {
    const step = Math.min(skip, remaining);
    remaining -= step;
    skip -= step;
    if (remaining <= 0) {
      index = (index + 1) % dashes.length;
      remaining = dashes[index];
      on = !on;
    }
  }

  const runs: Point[][] = [];
  let current: Point[] = on ? [points[0]] : [];

  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    let length = Math.hypot(x2 - x1, y2 - y1);
    if (length === 0) {
      continue;
    }
    const dx = (x2 - x1) / length;
    const dy = (y2 - y1) / length;
    let travelled = 0;

    while (length > remaining) {
      travelled += remaining;
      length -= remaining;
      const cut: Point = [x1 + dx * travelled, y1 + dy * travelled];
      if (on) {
        current.push(cut);
        runs.push(current);
        current = [];
      } else {
        current = [cut];
      }
      on = !on;
      index = (index + 1) % dashes.length;
      remaining = dashes[index];
    }

    remaining -= length;
    if (on) {
      current.push(points[i + 1]);
    }
  }

  if (current.length >= 2) {
    runs.push(current);
  }
  return runs;
}

/** Even-length, all-finite, non-zero-total pattern, or null to draw solid. */
function normalizePattern(pattern: number[] | null | undefined): number[] | null {
  if (!pattern?.length) {
    return null;
  }
  const values = pattern.map(v => (Number.isFinite(v) && v > 0 ? v : 0));
  if (values.reduce((a, b) => a + b, 0) <= 0) {
    return null;
  }
  return values.length % 2 === 0 ? values : [...values, ...values];
}
