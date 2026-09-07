import parse from 'parse-svg-path';
import simplify from 'simplify-path';
import contours from 'svg-path-contours';
import triangulate from 'triangulate-contours';
import type { GPUVegaCanvasContext } from '../types/context.js';
import type { PathGeometry } from '../types/geometry.js';
import type { Point } from '../util/dash.js';

const EMPTY: PathGeometry = { lines: [], triangles: [], closed: false, z: 0 };

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

/**
 * Triangulates an SVG path string into fill triangles and outline contours.
 * Results are cached on the context, keyed by the path string.
 *
 * `threshold` is the Douglas-Peucker tolerance in pixels. At 1.0 a gentle
 * curve collapses into visible facets, which is what an isocontour is made of.
 */
export default function geometryForPath(
  context: GPUVegaCanvasContext,
  path: string | null | undefined,
  threshold = 0.1,
): PathGeometry {
  if (!path) {
    return EMPTY;
  }

  const cacheKey = `${threshold}|${path}`;
  const cached = context._pathCache[cacheKey];
  if (cached !== undefined) {
    return cached;
  }

  // get a list of polylines/contours from svg contents
  const flat = contours(parse(path));
  let lines = flat.map(contour => simplify(contour, threshold));

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
    tri = { positions: [], cells: [] };
    if (!warnedTessellation) {
      warnedTessellation = true;
      console.warn('[vega-webgpu] A path could not be tessellated and is not drawn.');
    }
  }

  const z = context._randomZ ? 0.25 * (Math.random() - 0.5) : 0;

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
    closed: /z\s*$/i.test(path),
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
