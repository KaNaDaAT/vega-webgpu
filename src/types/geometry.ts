/** A position in an item's own coordinates. */
export type Point = [number, number];

/** Triangulated outline geometry for an SVG path, produced by geometryForPath. */
export interface PathGeometry {
  /** Polyline contours (input for stroke extrusion). */
  lines: Point[][];
  /** Flat [x, y] pairs forming fill triangles. */
  triangles: number[];
  /** The path and the flatness and scale it was traced at, for geometryForItem to cache on. */
  key?: { path: string; variant: string };
}

/** Per-item fill/stroke triangle buffers, produced by geometryForItem. */
export interface ItemGeometry {
  /** Flat [x, y] pairs for the fill. */
  fillTriangles: Float32Array;
  /** Flat [x, y] pairs for the extruded stroke outline. */
  strokeTriangles: Float32Array;
  /** Number of fill vertices. */
  fillCount: number;
  /** Number of stroke vertices. */
  strokeCount: number;
}
