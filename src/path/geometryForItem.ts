import extrude from 'extrude-polyline';
import type { GPUVegaCanvasContext } from '../types/context.js';
import type { ItemGeometry, PathGeometry } from '../types/geometry.js';
import type { FillStyle, StrokeStyle } from '../types/scene.js';

// canvas defaults to 10; a miter is never further from the contour than this
// many line widths, which is what bounds the spikes below
const MITER_LIMIT = 10;

export type GeometryItem = FillStyle &
  StrokeStyle & {
    opacity?: number;
  };

/**
 * Converts triangulated path geometry into per-item fill and stroke
 * triangle buffers. `dx`/`dy` apply an item-local translation (e.g. the
 * x/y of a path mark item). Group translation is handled by the render
 * offset uniform and must NOT be baked in here.
 */
export default function geometryForItem(
  context: GPUVegaCanvasContext,
  item: GeometryItem,
  shapeGeom: PathGeometry,
  cache = false,
  dx = 0,
  dy = 0,
): ItemGeometry {
  const key = shapeGeom.key;
  if (cache && key !== undefined) {
    const entry = context._geometryCache[key];
    if (entry) {
      return entry;
    }
  }

  const lineWidth = item.strokeWidth ?? 1;
  const lineCap = item.strokeCap ?? 'butt';
  const opacity = item.opacity ?? 1;
  let fillOpacity = opacity * (item.fillOpacity ?? 1);
  let strokeOpacity = opacity * (item.strokeOpacity ?? 1);

  const fillTriangleCoords = shapeGeom.triangles;
  let z = shapeGeom.z;

  if (item.fill === 'transparent') {
    fillOpacity = 0;
  }
  const fill = Boolean(item.fill) && fillOpacity > 0;
  const fillVertexCount = fill ? fillTriangleCoords.length / 3 : 0;

  if (item.stroke === 'transparent') {
    strokeOpacity = 0;
  }

  type StrokeMesh = ReturnType<ReturnType<typeof extrude>['build']>;
  const strokeMeshes: { mesh: StrokeMesh; lo: [number, number]; hi: [number, number] }[] = [];
  let strokeCellCount = 0;
  if (lineWidth > 0 && item.stroke && strokeOpacity > 0) {
    const strokeExtrude = extrude({
      thickness: lineWidth,
      cap: lineCap,
      join: 'miter',
      // at 1 almost every corner is bevel-cut
      miterLimit: MITER_LIMIT,
      closed: shapeGeom.closed,
    });
    const pad = MITER_LIMIT * lineWidth;
    for (const line of shapeGeom.lines) {
      const mesh = strokeExtrude.build(line);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of line) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
      strokeMeshes.push({ mesh, lo: [minX - pad, minY - pad], hi: [maxX + pad, maxY + pad] });
      strokeCellCount += mesh.cells.length;
    }
  }

  const triangles = new Float32Array(fillVertexCount * 3);
  const strokeTriangles = new Float32Array(strokeCellCount * 3 * 3);

  if (fill) {
    for (let i = 0; i < fillTriangleCoords.length; i += 3) {
      triangles[i] = fillTriangleCoords[i] + dx;
      triangles[i + 1] = fillTriangleCoords[i + 1] + dy;
      triangles[i + 2] = fillTriangleCoords[i + 2];
    }
  }

  let strokeVertexCount = 0;
  if (strokeMeshes.length > 0) {
    // strokes render slightly in front of fills
    z = -0.1;
    let i = 0;
    for (const { mesh, lo, hi } of strokeMeshes) {
      const { positions, cells } = mesh;
      // A contour that doubles back on itself (A to B to A, which geographic
      // slivers produce) turns by almost 180 degrees, and the miter there comes
      // back either NaN or thousands of pixels away. Either one smears its
      // triangle across the whole canvas, so drop the cell.
      const usable = (pi: number) => {
        const p = positions[pi];
        return (
          Number.isFinite(p[0]) &&
          Number.isFinite(p[1]) &&
          p[0] >= lo[0] &&
          p[0] <= hi[0] &&
          p[1] >= lo[1] &&
          p[1] <= hi[1]
        );
      };
      for (const cell of cells) {
        if (!cell.every(usable)) {
          continue;
        }
        for (const pointIndex of cell) {
          const p = positions[pointIndex];
          strokeTriangles[i * 3] = p[0] + dx;
          strokeTriangles[i * 3 + 1] = p[1] + dy;
          strokeTriangles[i * 3 + 2] = z;
          i++;
        }
      }
    }
    strokeVertexCount = i;
  }

  const result: ItemGeometry = {
    fillTriangles: triangles,
    strokeTriangles,
    fillCount: fillVertexCount,
    strokeCount: strokeVertexCount,
  };

  if (cache && key !== undefined) {
    context._geometryCache[key] = result;
    context._geometryCacheSize++;
    if (context._geometryCacheSize > 10000) {
      context._geometryCache = {};
      context._geometryCacheSize = 0;
    }
  }

  return result;
}
