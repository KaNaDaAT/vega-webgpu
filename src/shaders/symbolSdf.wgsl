struct Uniforms {
  resolution: vec2<f32>,
  offset: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

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
 * Triangle grown by `inflate` on every edge. Canvas joins a stroke with a
 * miter, so the outer edge of a stroked polygon keeps its sharp corners.
 * Offsetting the distance instead would round them.
 */
fn sdTriangleInflated(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, inradius: f32, inflate: f32) -> f32 {
    let g = (a + b + c) / 3.0;
    let k = 1.0 + inflate / max(inradius, 1e-6);
    return sdTriangle(p, g + (a - g) * k, g + (b - g) * k, g + (c - g) * k);
}

// The shape's own distance function, substituted per variant. `p` is in pixels
// from the symbol centre with y down, `s` is sqrt(size), and `inflate` grows
// every edge outward, which is what a miter join does.
fn shapeDistance(p: vec2<f32>, s: f32, inflate: f32) -> f32 {
//__SHAPE_SDF__
}

@vertex
fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput {
    var output: VertexOutput;
    // Reach the outer stroke edge plus a pixel, so the falloff is never clipped.
    let extent = instance.size * 0.75 + instance.stroke_width * 0.5 + 1.0;
    let local = model.position * extent;
    let c = cos(instance.angle);
    let sn = sin(instance.angle);
    let rotated = vec2<f32>(local.x * c - local.y * sn, local.x * sn + local.y * c);
    var pos = rotated + instance.center - uniforms.offset;
    pos = pos / uniforms.resolution;
    pos.y = 1.0 - pos.y;
    pos = pos * 2.0 - 1.0;
    output.pos = vec4<f32>(pos, 0.0, 1.0);
    output.local = local;
    output.fill = instance.fill_color;
    output.stroke = instance.stroke_color;
    output.size = instance.size;
    output.stroke_width = instance.stroke_width;
    return output;
}

/**
 * Fill and stroke each take their true share of the pixel, the same model the
 * rect shader uses. Triangulating the shape instead would leave its coverage to
 * MSAA, which can only express quarter steps.
 */
@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let half_sw = in.stroke_width * 0.5;
    let outer = clamp(0.5 - shapeDistance(in.local, in.size, half_sw), 0.0, 1.0);
    let inner = clamp(0.5 - shapeDistance(in.local, in.size, -half_sw), 0.0, 1.0);
    let fa = in.fill.a * inner;
    let sa = in.stroke.a * max(outer - inner, 0.0);
    let a = fa + sa;
    let rgb = (in.fill.rgb * fa + in.stroke.rgb * sa) / max(a, 1e-6);
    // A fragment with no coverage must not reach the blend state: under a
    // multiply or min it would still change the destination.
    if a <= 0.0 {
        discard;
    }
    return vec4<f32>(rgb, a);
}
