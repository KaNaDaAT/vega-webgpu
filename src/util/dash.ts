export type Point = [number, number];

/**
 * Splits a polyline into the drawn runs of a dash pattern, matching the canvas
 * setLineDash semantics: an odd-length pattern repeats to make it even, and the
 * offset skips into the pattern before the first point.
 *
 * Returns one polyline per drawn run, so callers can render them as ordinary
 * line segments.
 *
 * `bridge` is how much of a gap the caps at two facing run ends close between
 * them, which is the stroke width for a round or square cap and nothing for a
 * butt one. See bridgeGaps.
 */
export function dashPolyline(points: Point[], pattern: number[], offset = 0, bridge = 0): Point[][] {
  const even = normalizePattern(pattern);
  if (even === null || points.length < 2) {
    return points.length >= 2 ? [points] : [];
  }
  const closed = bridgeGaps(even, bridge);
  if (closed === null) {
    return [points];
  }
  const dashes = closed.dashes;
  offset += closed.shift;

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

  // A closed contour has no start: canvas strokes it as one loop, so a run that
  // reaches the seam and one that leaves it are a single run through a corner.
  // Left apart they meet as two flat ends and the corner goes unpainted.
  const last = points.length - 1;
  if (
    runs.length > 1 &&
    samePoint(points[0], points[last]) &&
    samePoint(runs[0][0], points[0]) &&
    samePoint(runs[runs.length - 1][runs[runs.length - 1].length - 1], points[last])
  ) {
    const tail = runs.pop() as Point[];
    runs[0] = [...tail, ...runs[0].slice(1)];
  }
  return runs;
}

/**
 * The pattern with every gap the caps close over folded into the runs either
 * side, and how far that moved the pattern's start.
 *
 * A square cap reaches half the stroke width past the end of its run, so two
 * runs with less than a stroke width between them meet, and the two caps fill
 * the gap exactly. Merging them is the same shape and drops the overlap, which
 * we would otherwise composite twice. Only square: two round caps cross short
 * of the stroke edge and leave a notch either side that a merged run paints
 * over, which is a bigger error than the overlap.
 *
 * Null when no gap survives, so the whole stroke is solid.
 */
function bridgeGaps(values: number[], bridge: number): { dashes: number[]; shift: number } | null {
  if (bridge <= 0) {
    return { dashes: values, shift: 0 };
  }
  const dashes: number[] = [];
  let on = 0;
  for (let i = 0; i < values.length; i += 2) {
    on += values[i];
    const gap = values[i + 1];
    if (gap <= bridge) {
      on += gap;
      continue;
    }
    dashes.push(on, gap);
    on = 0;
  }
  if (dashes.length === 0) {
    return null;
  }
  if (on > 0) {
    // The tail joins the first run of the next turn of the pattern, so the
    // merged one starts that much earlier and the offset winds it back.
    dashes[0] += on;
    return { dashes, shift: on };
  }
  return { dashes, shift: 0 };
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
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
