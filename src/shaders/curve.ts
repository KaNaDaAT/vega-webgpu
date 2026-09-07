import { SEGMENT_NORMAL, TO_NDC, fragmentTail, uniformBlock } from './common.js';

/**
 * Sub-segments each span is split into, and the vertex count a curve draw
 * asks for. Measured against canvas: 8 and 16 are indistinguishable and cost
 * the same, 4 is visibly worse.
 */
export const CURVE_SUBDIVISIONS = 8;

/**
 * How a span's four control points become a point and a tangent. Every cubic
 * d3 draws is one of these two: basis is the uniform B-spline behind `basis`
 * and `bundle`, bezier is what every other curve emits as a `C` command.
 */
const CURVES: Record<string, { at: string; tangent: string }> = {
  basis: {
    at: `    let t2 = t * t;
    let t3 = t2 * t;
    return ((1.0 - 3.0 * t + 3.0 * t2 - t3) * p0 + (4.0 - 6.0 * t2 + 3.0 * t3) * p1 +
            (1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3) * p2 + t3 * p3) / 6.0;`,
    tangent: `    let t2 = t * t;
    return (-3.0 * (1.0 - t) * (1.0 - t) * p0 + (9.0 * t2 - 12.0 * t) * p1 +
            (-9.0 * t2 + 6.0 * t + 3.0) * p2 + 3.0 * t2 * p3) / 6.0;`,
  },
  bezier: {
    at: `    let u = 1.0 - t;
    return u * u * u * p0 + 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3;`,
    tangent: `    let u = 1.0 - t;
    return 3.0 * u * u * (p1 - p0) + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (p3 - p2);`,
  },
};

/** Cubic splines evaluated on the GPU, one instance per span. */
export const curveShader = (blend: string, kind = 'basis'): string => {
  const curve = CURVES[kind];
  if (!curve) {
    throw new Error(`[vega-webgpu] No curve evaluation named '${kind}'.`);
  }
  return `
${uniformBlock('dpi')}

${TO_NDC}

// One instance per span. kind 0 is a curved span over p0..p3, 1 is a straight
// run from p0 to p1, which is how a line opens, closes and bridges an L command.
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

const K: u32 = ${CURVE_SUBDIVISIONS}u;

/** The span's curve, substituted per variant. */
fn curveAt(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> {
${curve.at}
}

/** Its derivative, so each joint takes the exact tangent. */
fn curveTangent(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> {
${curve.tangent}
}

/**
 * A cubic whose first control point repeats its endpoint has a zero derivative
 * there, which d3's monotone curves produce on a flat run. The chord is the
 * limiting direction, so fall back to it rather than to an arbitrary normal.
 */
fn spanTangent(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>, t: f32) -> vec2<f32> {
    let d = curveTangent(p0, p1, p2, p3, t);
    return select(p3 - p0, d, length(d) > 1e-6);
}

${SEGMENT_NORMAL}

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
        a = curveAt(instance.p0, instance.p1, instance.p2, instance.p3, t0);
        b = curveAt(instance.p0, instance.p1, instance.p2, instance.p3, t1);
        na = normalAt(spanTangent(instance.p0, instance.p1, instance.p2, instance.p3, t0));
        nb = normalAt(spanTangent(instance.p0, instance.p1, instance.p2, instance.p3, t1));
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

    var out: VertexOutput;
    out.pos = vec4<f32>(toNdc(point - uniforms.offset, uniforms.resolution), 0.0, 1.0);
    out.color = instance.color;
    out.across = across;
    out.half_width = instance.stroke_width * 0.5;
    return out;
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    // coverage across the stroke, the way canvas antialiases an edge
    let d = max(uniforms.dpi, 0.001);
    let coverage = clamp((in.half_width - abs(in.across)) * d + 0.5, 0.0, 1.0);
    return vec4<f32>(in.color.rgb, in.color.a * coverage);
}

${fragmentTail(blend)}
`;
};
