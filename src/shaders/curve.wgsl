struct Uniforms {
  resolution: vec2<f32>,
  offset: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

// One instance per B-spline span. `kind` 0 is a curved span over p0..p3, 1 is a
// straight run from p0 to p1, which is how d3's basis opens and closes a line.
struct InstanceInput {
  @location(0) p0: vec2<f32>,
  @location(1) p1: vec2<f32>,
  @location(2) p2: vec2<f32>,
  @location(3) p3: vec2<f32>,
  @location(4) color: vec4<f32>,
  @location(5) stroke_width: f32,
  @location(6) kind: f32,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
  // signed distance across the stroke, in pixels, for the edge falloff
  @location(1) across: f32,
  @location(2) half_width: f32,
}

// Sub-segments each span is split into. Measured against canvas: 8 and 16 are
// indistinguishable and cost the same, 4 is visibly worse.
const K: u32 = 8u;

/** Uniform cubic B-spline, the curve d3's basis draws. */
fn basisAt(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> {
    let t2 = t * t;
    let t3 = t2 * t;
    return ((1.0 - 3.0 * t + 3.0 * t2 - t3) * p0 + (4.0 - 6.0 * t2 + 3.0 * t3) * p1 +
            (1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3) * p2 + t3 * p3) / 6.0;
}

/** Its derivative, so each joint takes the exact tangent. */
fn basisTangent(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> {
    let t2 = t * t;
    return (-3.0 * (1.0 - t) * (1.0 - t) * p0 + (9.0 * t2 - 12.0 * t) * p1 +
            (-9.0 * t2 + 6.0 * t + 3.0) * p2 + 3.0 * t2 * p3) / 6.0;
}

fn normalAt(d: vec2<f32>) -> vec2<f32> {
    let len = length(d);
    let dir = select(vec2<f32>(1.0, 0.0), d / len, len > 1e-9);
    return vec2<f32>(-dir.y, dir.x);
}

/**
 * Every joint offsets along the analytic tangent, so neighbouring quads share
 * an edge exactly. Overlapping them instead would double-blend a translucent
 * stroke, which is most of what this spec draws.
 */
@vertex
fn main_vertex(instance: InstanceInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    let sub = vertexIndex / 6u;
    let corner = vertexIndex % 6u;
    let straight = instance.kind > 0.5;

    var a: vec2<f32>;
    var b: vec2<f32>;
    var na: vec2<f32>;
    var nb: vec2<f32>;
    if straight {
        // one quad carries the run, the rest collapse and are culled
        if sub > 0u {
            var out: VertexOutput;
            out.pos = vec4<f32>(0.0, 0.0, 0.0, 1.0);
            out.color = vec4<f32>(0.0, 0.0, 0.0, 0.0);
            out.across = 0.0;
            out.half_width = 1.0;
            return out;
        }
        a = instance.p0;
        b = instance.p1;
        na = normalAt(b - a);
        nb = na;
    } else {
        let t0 = f32(sub) / f32(K);
        let t1 = f32(sub + 1u) / f32(K);
        a = basisAt(instance.p0, instance.p1, instance.p2, instance.p3, t0);
        b = basisAt(instance.p0, instance.p1, instance.p2, instance.p3, t1);
        na = normalAt(basisTangent(instance.p0, instance.p1, instance.p2, instance.p3, t0));
        nb = normalAt(basisTangent(instance.p0, instance.p1, instance.p2, instance.p3, t1));
    }

    // grow by a pixel so the analytic falloff is never clipped by the geometry
    let half = instance.stroke_width * 0.5 + 1.0;
    var point: vec2<f32>;
    var across: f32;
    switch corner {
        case 0u: { point = a - na * half; across = -half; }
        case 1u: { point = a + na * half; across = half; }
        case 2u: { point = b - nb * half; across = -half; }
        case 3u: { point = b - nb * half; across = -half; }
        case 4u: { point = a + na * half; across = half; }
        default: { point = b + nb * half; across = half; }
    }

    var pos = (point - uniforms.offset) / uniforms.resolution;
    pos.y = 1.0 - pos.y;
    pos = pos * 2.0 - 1.0;

    var out: VertexOutput;
    out.pos = vec4<f32>(pos, 0.0, 1.0);
    out.color = instance.color;
    out.across = across;
    out.half_width = instance.stroke_width * 0.5;
    return out;
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    // coverage across the stroke, the way canvas antialiases an edge
    let coverage = clamp(in.half_width - abs(in.across) + 0.5, 0.0, 1.0);
    let a = in.color.a * coverage;
    // A fragment with no coverage must not reach the blend state: under a
    // multiply or min it would still change the destination.
    if a <= 0.0 {
        discard;
    }
    return vec4<f32>(in.color.rgb, a);
}
