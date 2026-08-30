/**
 * Declarations for small geometry dependencies that ship without types.
 * Shapes are derived from each package's README and observed runtime usage.
 */

declare module 'parse-svg-path' {
  /** Parses an SVG path string into segments of [command, ...coordinates]. */
  export type PathSegment = [string, ...number[]];
  export default function parse(path: string): PathSegment[];
}

declare module 'simplify-path' {
  export type Point = [number, number];
  /** Ramer-Douglas-Peucker polyline simplification. */
  export default function simplify(points: Point[], tolerance?: number): Point[];
}

declare module 'svg-path-contours' {
  import type { PathSegment } from 'parse-svg-path';
  export type Contour = [number, number][];
  /** Converts parsed SVG path segments into a list of polyline contours. */
  export default function contours(segments: PathSegment[], scale?: number): Contour[];
}

declare module 'triangulate-contours' {
  export interface TriangulationMesh {
    positions: [number, number][];
    cells: [number, number, number][];
  }
  export default function triangulate(contours: [number, number][][]): TriangulationMesh;
}

declare module 'extrude-polyline' {
  export interface ExtrudeOptions {
    thickness?: number;
    cap?: string;
    join?: string;
    miterLimit?: number;
    closed?: boolean;
  }
  export interface ExtrudeMesh {
    positions: [number, number][];
    cells: [number, number, number][];
  }
  export interface Stroke {
    build(points: [number, number][]): ExtrudeMesh;
  }
  export default function extrude(options?: ExtrudeOptions): Stroke;
}
