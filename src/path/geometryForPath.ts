import bezier from 'adaptive-bezier-curve';
import simplify from 'simplify-path';
import triangulate from 'triangulate-contours';
import { pathParse, pathRender } from 'vega-scenegraph';
import type { GPUVegaCanvasContext } from '../types/context.js';
import type { PathGeometry } from '../types/geometry.js';
import type { Point } from '../util/dash.js';

const EMPTY: PathGeometry = { lines: [], triangles: [], z: 0 };

let warnedPath = false;

/**
 * An svg path as polyline contours, flattening the curves and leaving the
 * straight runs alone.
 *
 * The commands come from vega's own path renderer, which is what the canvas
 * `path` mark draws with, so its reading of a path is ours. That matters
 * because it is not the specified one in three places, and a conforming parser
 * disagrees with it in each: `S` reflects the running control point whatever
 * came before, `T` does too while its relative form `t` checks, and an arc with
 * a zero radius is dropped where the spec draws a line to its end. Reading the
 * same commands is the only way the two renderers agree on those.
 *
 * A straight run keeps its two points at any flatness. The flattener this
 * replaced normalized every command to a cubic first, so a lineTo arrived as a
 * bezier with its control points on its own ends and was subdivided like any
 * other curve. The subdivision does not land on the ends, so the corners moved:
 * at a fine setting a step line's corner at (256.5, 65) came back as
 * (256.5, 64.93) and the join built there lost its tip.
 *
 * `subdivideStraight` gives back what that flattener produced, redundant points
 * and repeats and all, for the one caller that wants it: see the fallback in
 * geometryForPath.
 */
function contoursOf(path: string, scale: number, subdivideStraight = false): Point[][] {
  const out: Point[][] = [];
  let points: Point[] = [];
  let px = 0;
  let py = 0;
  let sx = 0;
  let sy = 0;

  const flush = (): void => {
    if (points.length > 0) {
      out.push(points);
      points = [];
    }
  };

  const curve = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): void => {
    const from = points.length;
    bezier([px, py], [x1, y1], [x2, y2], [x, y], scale, points);
    // Both ends come back, so the point shared with the previous segment
    // repeats. The subdivided form keeps those on purpose, since it exists to
    // hand tess2 the shape the old flattener did, down to the repeats.
    if (!subdivideStraight && from > 0 && samePoint(points[from - 1], points[from])) {
      points.splice(from, 1);
    }
    px = x;
    py = y;
  };

  const line = (x: number, y: number): void => {
    if (subdivideStraight) {
      curve(px, py, x, y, x, y);
      return;
    }
    pushPoint(points, px, py);
    pushPoint(points, x, y);
    px = x;
    py = y;
  };

  let commands;
  try {
    commands = pathParse(path);
  } catch {
    if (!warnedPath) {
      warnedPath = true;
      console.warn('[vega-webgpu] An svg path could not be parsed and is not drawn.');
    }
    return out;
  }

  pathRender(
    {
      moveTo(x, y) {
        flush();
        px = sx = x;
        py = sy = y;
      },
      lineTo: line,
      bezierCurveTo: curve,
      quadraticCurveTo(cx, cy, x, y) {
        // the cubic a quadratic raises to, which is what the old parser emitted
        curve(px + (2 / 3) * (cx - px), py + (2 / 3) * (cy - py), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y);
      },
      closePath() {
        line(sx, sy);
      },
    },
    commands,
  );
  flush();
  return out;
}

function samePoint(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function pushPoint(points: Point[], x: number, y: number): void {
  const last = points[points.length - 1];
  if (!last || last[0] !== x || last[1] !== y) {
    points.push([x, y]);
  }
}

let warnedTessellation = false;

/** Triangulates contours, or null when tess2 cannot. */
function tessellate(lines: Point[][]): ReturnType<typeof triangulate> | null {
  try {
    return triangulate(lines, { windingRule: WINDING_NONZERO });
  } catch {
    return null;
  }
}

// tess2's WINDING_NONZERO. canvas fills nonzero, and triangulate-contours asks
// for even-odd, which leaves the middle of a self-intersecting path hollow.
const WINDING_NONZERO = 1;

/** What a contour about to be dashed is flattened at. See geometryForPath. */
export const DASH_FLATNESS = 1;

const CURVE_FLATNESS = 4;
/** Douglas-Peucker tolerance in pixels. At 1.0 a gentle curve visibly facets. */
const CURVE_TOLERANCE = 0.1;

/**
 * Triangulates an SVG path string into fill triangles and outline contours.
 * Results are cached on the context, keyed by the path string.
 *
 * `scale` is how finely a bezier is flattened. The default follows the curve
 * closely, which is what every consumer wants but one: `arc-shapes` goes from
 * 0.211% of pixels to 0.058%, `gradient-strokes` 0.161% to 0.054%,
 * `path-shapes` 0.034% to 0.005% and `trail` 0.016% to 0.009%.
 *
 * Four rather than more. It is where the gain flattens out, and past it the
 * extra vertices start costing: at 8 a nearly straight run picks up enough
 * near-collinear joints that one of them loses a pixel, which took `line-shapes`
 * at dpr 2 from worst channel 71 to 134 while its pixel count did not move.
 *
 * A dash is the exception and takes DASH_FLATNESS instead. Its runs are
 * measured along this polyline, so its length has to be the one canvas measures
 * rather than the curve's, and canvas is not measuring the curve: at the
 * default here `mark-dashes` goes 0.037% to 0.055% and worst channel 115 to
 * 206, and a dashed rounded border 0.010% to 0.034%.
 */
export default function geometryForPath(
  context: GPUVegaCanvasContext,
  path: string | null | undefined,
  scale?: number,
): PathGeometry {
  if (!path) {
    return EMPTY;
  }

  // A chord's error is bounded in path units, so the same contour sits twice as
  // far from its own curve on a grid twice as fine. The flatness follows the
  // ratio, and a dash does not: it keeps the coarse contour whatever the ratio,
  // since it is measured along the polyline rather than drawn on it.
  const dpi = context._uniforms.dpi || 1;
  const flatness = scale ?? CURVE_FLATNESS * dpi;

  const cacheKey = `${flatness}|${path}`;
  const cached = context._pathCache[cacheKey];
  if (cached !== undefined) {
    return cached;
  }

  // get a list of polylines/contours from svg contents
  const flat = contoursOf(path, flatness);
  let lines = flat.map(contour => simplify(contour, CURVE_TOLERANCE));

  // Simplifying can nudge a contour into a self intersection, which tess2
  // reaches an undefined identifier on and throws. Dropping the shape there
  // loses it silently, and a county went missing off the choropleth that way,
  // so fall back to the contour as traced.
  let tri = tessellate(lines);
  if (tri === null) {
    lines = flat;
    tri = tessellate(lines);
  }
  if (tri === null) {
    // tess2 reaches an undefined identifier on outlines it does not like, and
    // an exact one is more likely to be among them than the same shape carrying
    // redundant points along its straight runs. A county of four contours went
    // missing off the choropleth that way: exact it throws at 19/9/18/137
    // points, and the flattener's own shape simplified to 19/9/18/143 gives 188
    // triangles. So the last try before giving up is that shape.
    lines = contoursOf(path, flatness, true).map(contour => simplify(contour, CURVE_TOLERANCE));
    tri = tessellate(lines);
  }
  for (let coarse = flatness / 2; tri === null && coarse >= flatness / 8; coarse /= 2) {
    // A coarser curve is a shape it takes where the fine one throws, and giving
    // up curve accuracy beats giving up the mark: the second ribbon of `trail`
    // went missing at dpr 2, where the flatness is twice what it is at dpr 1.
    lines = contoursOf(path, coarse).map(contour => simplify(contour, CURVE_TOLERANCE));
    tri = tessellate(lines);
  }
  if (tri === null) {
    tri = { positions: [], cells: [] };
    if (!warnedTessellation) {
      warnedTessellation = true;
      console.warn('[vega-webgpu] A path could not be tessellated and is not drawn.');
    }
  }

  const z = 0;

  const triangles: number[] = [];
  const { cells, positions } = tri;
  for (let ci = 0; ci < cells.length; ci++) {
    const cell = cells[ci];
    const p1 = positions[cell[0]];
    const p2 = positions[cell[1]];
    const p3 = positions[cell[2]];
    triangles.push(p1[0], p1[1], z, p2[0], p2[1], z, p3[0], p3[1], z);
  }

  const geom: PathGeometry = {
    lines,
    triangles,
    z,
    key: path,
  };

  context._pathCache[cacheKey] = geom;
  context._pathCacheSize++;
  if (context._pathCacheSize > 10000) {
    context._pathCache = {};
    context._pathCacheSize = 0;
  }
  return geom;
}
