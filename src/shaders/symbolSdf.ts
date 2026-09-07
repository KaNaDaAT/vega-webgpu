import { FILL_STROKE_SHARE, TO_NDC, fragmentTail, uniformBlock } from './common.js';

/**
 * `circle` is absent because it already has a dedicated analytic shader and
 * routing it here measured neutral, 36/57 against 35/61 worst channel.
 *
 * `cross` is deliberately absent: it is a union of two boxes, and eroding that
 * union for the inner stroke edge is not the union of the eroded boxes, which
 * puts its reflex corners in the wrong place. It stays triangulated. `arrow` is
 * a union too, so its inner edge has the same approximation at the two barbs,
 * which measured better than the triangulated shape rather than worse.
 *
 * Distance functions for the symbol shapes with a closed form, keyed by vega's
 * shape name. Each is the body of `shapeDistance(p, s, inflate)` below, where
 * `s` is sqrt(size), the scale d3-symbol works in.
 *
 * The constants come straight from d3's own paths at size 100 (s = 10):
 * square `M-5,-5h10v10h-10Z`, diamond `M-5,0L0,-5L5,0L0,5Z`,
 * cross `M-5,-2...` and triangle-up `M0,-4.33L-5,4.33L5,4.33Z`.
 */
interface ShapeSdf {
  /** Body of `shapeDistance(p, s, inflate)`. */
  sdf: string;
  /** Farthest the unstroked shape reaches from the origin, in units of s. */
  reach: number;
  /** How far a miter carries a vertex out, in units of the stroke half width. */
  miter: number;
}

const SHAPE_SDF: Record<string, ShapeSdf> = {
  square: {
    sdf: '    return sdBox(p, vec2<f32>(s * 0.5 + inflate, s * 0.5 + inflate));',
    reach: 0.70710678,
    miter: 1.41421356,
  },
  // vertices sit at s/2 on each axis, and moving both edges out by `inflate`
  // raises the |x| + |y| threshold by inflate * sqrt(2)
  diamond: {
    sdf: '    return (abs(p.x) + abs(p.y) - (s * 0.5 + inflate * 1.41421356)) * 0.70710678;',
    reach: 0.5,
    miter: 1.41421356,
  },
  'triangle-up': {
    sdf: `    return sdTriangleInflated(p, vec2<f32>(0.0, -0.433 * s), vec2<f32>(-0.5 * s, 0.433 * s), vec2<f32>(0.5 * s, 0.433 * s), inflate);`,
    reach: 0.57735,
    miter: 2,
  },
  'triangle-down': {
    sdf: `    return sdTriangleInflated(p, vec2<f32>(0.0, 0.433 * s), vec2<f32>(0.5 * s, -0.433 * s), vec2<f32>(-0.5 * s, -0.433 * s), inflate);`,
    reach: 0.57735,
    miter: 2,
  },
  'triangle-right': {
    sdf: `    return sdTriangleInflated(p, vec2<f32>(0.433 * s, 0.0), vec2<f32>(-0.433 * s, 0.5 * s), vec2<f32>(-0.433 * s, -0.5 * s), inflate);`,
    reach: 0.57735,
    miter: 2,
  },
  'triangle-left': {
    sdf: `    return sdTriangleInflated(p, vec2<f32>(-0.433 * s, 0.0), vec2<f32>(0.433 * s, -0.5 * s), vec2<f32>(0.433 * s, 0.5 * s), inflate);`,
    reach: 0.57735,
    miter: 2,
  },
  triangle: {
    sdf: `    return sdTriangleInflated(p, vec2<f32>(0.0, -0.5774 * s), vec2<f32>(-0.5 * s, 0.2887 * s), vec2<f32>(0.5 * s, 0.2887 * s), inflate);`,
    reach: 0.57735,
    miter: 2,
  },
  // vega draws a wedge as an isosceles triangle a quarter as wide as a triangle,
  // so its tip is sharp enough that a miter carries it seven half widths out
  wedge: {
    sdf: `    return sdTriangleInflated(p, vec2<f32>(0.0, -0.57735 * s), vec2<f32>(-0.125 * s, 0.288675 * s), vec2<f32>(0.125 * s, 0.288675 * s), inflate);`,
    reach: 0.7578,
    miter: 7.01,
  },
  // a shaft box under a head triangle, and dilating a union is the union of the
  // dilations, so the outer stroke edge is exact
  arrow: {
    sdf: `    let shaft = sdBox(p - vec2<f32>(0.0, 0.21875 * s), vec2<f32>(0.071429 * s + inflate, 0.28125 * s + inflate));
    let head = sdTriangleInflated(p, vec2<f32>(0.2 * s, -0.0625 * s), vec2<f32>(0.0, -0.5 * s), vec2<f32>(-0.2 * s, -0.0625 * s), inflate);
    return min(shaft, head);`,
    reach: 0.5051,
    miter: 2.41,
  },
};

/** True when the shape has a distance function and can skip triangulation. */
export function hasSdf(shape: string): boolean {
  return Object.hasOwn(SHAPE_SDF, shape);
}

/**
 * One shader per shape rather than one shader switching on a shape id, so the
 * fragment stays branchless.
 */
export const symbolSdfShader = (blend: string, shape?: string): string => {
  const spec = shape === undefined ? undefined : SHAPE_SDF[shape];
  if (spec === undefined) {
    throw new Error(`[vega-webgpu] No distance function for symbol shape '${shape}'.`);
  }
  return `
${uniformBlock('dpi')}

${TO_NDC}

${FILL_STROKE_SHARE}

struct VertexInput {
  @location(0) position: vec2<f32>,
}

struct InstanceInput {
  @location(1) center: vec2<f32>,
  // sqrt of the symbol area, which is what d3-symbol scales every shape by
  @location(2) size: f32,
  @location(3) fill_color: vec4<f32>,
  @location(4) stroke_color: vec4<f32>,
  @location(5) stroke_width: f32,
  @location(6) angle: f32,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) local: vec2<f32>,
  @location(1) fill: vec4<f32>,
  @location(2) stroke: vec4<f32>,
  @location(3) size: f32,
  @location(4) stroke_width: f32,
}

/** Exact distance to a triangle, negative inside. */
fn sdTriangle(p: vec2<f32>, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>) -> f32 {
    let e0 = p1 - p0;
    let e1 = p2 - p1;
    let e2 = p0 - p2;
    let v0 = p - p0;
    let v1 = p - p1;
    let v2 = p - p2;
    let pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    let pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    let pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    let s = sign(e0.x * e2.y - e0.y * e2.x);
    let d = min(
        min(
            vec2<f32>(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
            vec2<f32>(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x)),
        ),
        vec2<f32>(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)),
    );
    return -sqrt(d.x) * sign(d.y);
}

/** Distance to an axis-aligned box of half extent b, negative inside. */
fn sdBox(p: vec2<f32>, b: vec2<f32>) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec2<f32>(0.0, 0.0))) + min(max(d.x, d.y), 0.0);
}

/**
 * Triangle grown outward by inflate on every edge. Canvas joins a stroke with a
 * miter, so the outer edge of a stroked polygon keeps its sharp corners, and
 * offsetting the distance instead would round them.
 *
 * Scaling about the incentre is what moves every edge by the same distance. The
 * centroid only does that for an equilateral triangle, and a thin one like the
 * wedge comes out with the wrong inner edge.
 */
fn sdTriangleInflated(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, inflate: f32) -> f32 {
    let la = distance(b, c);
    let lb = distance(a, c);
    let lc = distance(a, b);
    let perimeter = la + lb + lc;
    let incentre = (la * a + lb * b + lc * c) / perimeter;
    let area = abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) * 0.5;
    let inradius = area / max(perimeter * 0.5, 1e-6);
    let k = 1.0 + inflate / max(inradius, 1e-6);
    return sdTriangle(p, incentre + (a - incentre) * k, incentre + (b - incentre) * k, incentre + (c - incentre) * k);
}

// The shape's own distance function, substituted per variant. p is in pixels
// from the symbol centre with y down, s is sqrt(size), and inflate grows every
// edge outward, which is what a miter join does.
fn shapeDistance(p: vec2<f32>, s: f32, inflate: f32) -> f32 {
${spec.sdf}
}

/**
 * How far the stroked shape reaches from its origin, plus a pixel so the
 * falloff is never clipped. A miter carries a sharp vertex much further than
 * the stroke half width, and the wedge's tip carries it seven times as far.
 */
fn shapeExtent(s: f32, half_width: f32) -> f32 {
    return ${spec.reach} * s + ${spec.miter} * half_width + 1.0;
}

@vertex
fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput {
    let extent = shapeExtent(instance.size, instance.stroke_width * 0.5);
    let local = model.position * extent;
    let c = cos(instance.angle);
    let sn = sin(instance.angle);
    let rotated = vec2<f32>(local.x * c - local.y * sn, local.x * sn + local.y * c);

    var output: VertexOutput;
    output.pos = vec4<f32>(toNdc(rotated + instance.center - uniforms.offset, uniforms.resolution), 0.0, 1.0);
    output.local = local;
    output.fill = instance.fill_color;
    output.stroke = instance.stroke_color;
    output.size = instance.size;
    output.stroke_width = instance.stroke_width;
    return output;
}

/**
 * Triangulating the shape instead would leave its coverage to MSAA, which can
 * only express quarter steps.
 */
fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    let d = max(uniforms.dpi, 0.001);
    let half_sw = in.stroke_width * 0.5;
    let outer = clamp(0.5 - shapeDistance(in.local, in.size, half_sw) * d, 0.0, 1.0);
    let inner = clamp(0.5 - shapeDistance(in.local, in.size, -half_sw) * d, 0.0, 1.0);
    return fillStrokeShare(in.fill, in.stroke, inner, outer);
}

${fragmentTail(blend)}
`;
};
