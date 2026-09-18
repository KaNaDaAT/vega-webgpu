/**
 * Declarations for small geometry dependencies that ship without types.
 * Shapes are derived from each package's README and observed runtime usage.
 */

declare module 'simplify-path' {
  export type Point = [number, number];
  /** Ramer-Douglas-Peucker polyline simplification. */
  export default function simplify(points: Point[], tolerance?: number): Point[];
}

declare module 'adaptive-bezier-curve' {
  export type Point = [number, number];
  /**
   * Subdivides a cubic until it is flat to within `scale`, appending the result
   * to `points`. Both ends are included, so consecutive calls repeat the point
   * they share.
   */
  export default function bezier(
    start: Point,
    c1: Point,
    c2: Point,
    end: Point,
    scale: number,
    points: Point[],
  ): Point[];
}

declare module 'triangulate-contours' {
  export interface TriangulationMesh {
    positions: [number, number][];
    cells: [number, number, number][];
  }
  export interface TriangulateOptions {
    /** tess2 winding rule: 0 even-odd, 1 nonzero. Defaults to even-odd. */
    windingRule?: number;
  }
  export default function triangulate(contours: [number, number][][], opt?: TriangulateOptions): TriangulationMesh;
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
