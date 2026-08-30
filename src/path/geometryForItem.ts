import extrude from 'extrude-polyline';
import type { GPUVegaCanvasContext } from '../types/context.js';
import type { ItemGeometry, PathGeometry } from '../types/geometry.js';
import type { FillStyle, StrokeStyle } from '../types/scene.js';

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

  const strokeMeshes: ReturnType<ReturnType<typeof extrude>['build']>[] = [];
  let strokeCellCount = 0;
  if (lineWidth > 0 && item.stroke && strokeOpacity > 0) {
    const strokeExtrude = extrude({
      thickness: lineWidth,
      cap: lineCap,
      join: 'miter',
      // canvas defaults to 10; at 1 almost every corner is bevel-cut
      miterLimit: 10,
      closed: shapeGeom.closed,
    });
    for (const line of shapeGeom.lines) {
      const mesh = strokeExtrude.build(line);
      strokeMeshes.push(mesh);
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

  if (strokeMeshes.length > 0) {
    // strokes render slightly in front of fills
    z = -0.1;
    let i = 0;
    for (const mesh of strokeMeshes) {
      const { positions, cells } = mesh;
      for (const cell of cells) {
        for (const pointIndex of cell) {
          const p = positions[pointIndex];
          strokeTriangles[i * 3] = p[0] + dx;
          strokeTriangles[i * 3 + 1] = p[1] + dy;
          strokeTriangles[i * 3 + 2] = z;
          i++;
        }
      }
    }
  }

  const result: ItemGeometry = {
    fillTriangles: triangles,
    strokeTriangles,
    fillCount: fillVertexCount,
    strokeCount: strokeCellCount * 3,
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
