/** Triangulated outline geometry for an SVG path, produced by geometryForPath. */
export interface PathGeometry {
  /** Polyline contours (input for stroke extrusion). */
  lines: [number, number][][];
  /** Flat [x, y, z] triples forming fill triangles. */
  triangles: number[];
  closed: boolean;
  z: number;
  key?: string;
}

/** Per-item fill/stroke triangle buffers, produced by geometryForItem. */
export interface ItemGeometry {
  /** Flat [x, y, z] triples for the fill. */
  fillTriangles: Float32Array;
  /** Flat [x, y, z] triples for the extruded stroke outline. */
  strokeTriangles: Float32Array;
  /** Number of fill vertices. */
  fillCount: number;
  /** Number of stroke vertices. */
  strokeCount: number;
}
