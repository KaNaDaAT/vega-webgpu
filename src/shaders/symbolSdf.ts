import { FILL_STROKE_SHARE, TO_NDC, fragmentTail, uniformBlock } from './common.js';

/**
 * `circle` is absent because it already has a dedicated analytic shader and
 * routing it here measured neutral, 36/57 against 35/61 worst channel.
 *
 * `cross` is deliberately absent: it is a union of two boxes, and eroding that
 * union for the inner stroke edge is not the union of the eroded boxes, which
 * puts its reflex corners in the wrong place. It stays triangulated.
 *
 * Distance functions for the symbol shapes with a closed form, keyed by vega's
 * shape name. Each is the body of `shapeDistance(p, s, inflate)` below, where
 * `s` is sqrt(size), the scale d3-symbol works in.
 *
 * The constants come straight from d3's own paths at size 100 (s = 10):
 * square `M-5,-5h10v10h-10Z`, diamond `M-5,0L0,-5L5,0L0,5Z`,
 * cross `M-5,-2...` and triangle-up `M0,-4.33L-5,4.33L5,4.33Z`.
 */
const SHAPE_SDF: Record<string, string> = {
  square: '    return sdBox(p, vec2<f32>(s * 0.5 + inflate, s * 0.5 + inflate));',
  // vertices sit at s/2 on each axis, and moving both edges out by `inflate`
  // raises the |x| + |y| threshold by inflate * sqrt(2)
  diamond: '    return (abs(p.x) + abs(p.y) - (s * 0.5 + inflate * 1.41421356)) * 0.70710678;',
  // every d3 triangle is equilateral, so its inradius is s / (2 * sqrt(3))
  'triangle-up': `    return sdTriangleInflated(p, vec2<f32>(0.0, -0.433 * s), vec2<f32>(-0.5 * s, 0.433 * s), vec2<f32>(0.5 * s, 0.433 * s), 0.28868 * s, inflate);`,
  'triangle-down': `    return sdTriangleInflated(p, vec2<f32>(0.0, 0.433 * s), vec2<f32>(0.5 * s, -0.433 * s), vec2<f32>(-0.5 * s, -0.433 * s), 0.28868 * s, inflate);`,
  'triangle-right': `    return sdTriangleInflated(p, vec2<f32>(0.433 * s, 0.0), vec2<f32>(-0.433 * s, 0.5 * s), vec2<f32>(-0.433 * s, -0.5 * s), 0.28868 * s, inflate);`,
  'triangle-left': `    return sdTriangleInflated(p, vec2<f32>(-0.433 * s, 0.0), vec2<f32>(0.433 * s, -0.5 * s), vec2<f32>(0.433 * s, 0.5 * s), 0.28868 * s, inflate);`,
  triangle: `    return sdTriangleInflated(p, vec2<f32>(0.0, -0.5774 * s), vec2<f32>(-0.5 * s, 0.2887 * s), vec2<f32>(0.5 * s, 0.2887 * s), 0.28868 * s, inflate);`,
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
  const body = shape === undefined ? undefined : SHAPE_SDF[shape];
  if (body === undefined) {
    throw new Error(`[vega-webgpu] No distance function for symbol shape '${shape}'.`);
  }
  return `
${uniformBlock()}

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
 * miter, so the outer edge of a stroked polygon keeps its sharp corners.
 * Offsetting the distance instead would round them.
 */
fn sdTriangleInflated(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, inradius: f32, inflate: f32) -> f32 {
    let g = (a + b + c) / 3.0;
    let k = 1.0 + inflate / max(inradius, 1e-6);
    return sdTriangle(p, g + (a - g) * k, g + (b - g) * k, g + (c - g) * k);
}

// The shape's own distance function, substituted per variant. p is in pixels
// from the symbol centre with y down, s is sqrt(size), and inflate grows every
// edge outward, which is what a miter join does.
fn shapeDistance(p: vec2<f32>, s: f32, inflate: f32) -> f32 {
${body}
}

@vertex
fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput {
    // Reach the outer stroke edge plus a pixel, so the falloff is never clipped.
    let extent = instance.size * 0.75 + instance.stroke_width * 0.5 + 1.0;
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
    let half_sw = in.stroke_width * 0.5;
    let outer = clamp(0.5 - shapeDistance(in.local, in.size, half_sw), 0.0, 1.0);
    let inner = clamp(0.5 - shapeDistance(in.local, in.size, -half_sw), 0.0, 1.0);
    return fillStrokeShare(in.fill, in.stroke, inner, outer);
}

${fragmentTail(blend)}
`;
};
