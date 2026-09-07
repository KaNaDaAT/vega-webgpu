import { SEGMENT_NORMAL, TO_NDC, fragmentTail, uniformBlock } from './common.js';

/**
 * One quad per line segment instance, with the coverage of the segment computed
 * analytically. `caps` rounds an end, which is both a round stroke cap and the
 * round join at an interior vertex of a polyline. Dashes, dashed rect borders,
 * diagonal rules and line segments all come through here.
 */
export const slineShader = (blend: string): string => `
${uniformBlock('dpi')}

${TO_NDC}

${SEGMENT_NORMAL}

struct VertexInput {
    @location(0) start: vec2<f32>,
    @location(1) end: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) stroke_width: f32,
    @location(4) caps: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) fill: vec4<f32>,
    // segment ends and half width in device pixels, for analytic coverage
    @location(1) a_dev: vec2<f32>,
    @location(2) b_dev: vec2<f32>,
    @location(3) half_dev: f32,
    @location(4) caps: vec2<f32>,
}

@vertex
fn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    let d = max(uniforms.dpi, 0.001);
    let delta = in.end - in.start;
    let direction = safeDirection(delta);
    let normal = normalAt(delta);

    // Grow the quad by one device pixel so the falloff is not clipped, which
    // leaves every pixel the segment touches fully rasterized. A round end
    // reaches half the stroke width further.
    let pad = 1.0 / d;
    let half = in.stroke_width * 0.5;
    let side = normal * (half + pad);
    let behind = direction * (pad + select(0.0, half, in.caps.x > 0.5));
    let ahead = direction * (pad + select(0.0, half, in.caps.y > 0.5));

    let p1 = in.start - side - behind;
    let p2 = in.start + side - behind;
    let p3 = in.end - side + ahead;
    let p4 = in.end + side + ahead;

    var vertices = array(p1, p2, p3, p4, p2, p3);
    let ndc = toNdc(vertices[vertexIndex] - uniforms.offset, uniforms.resolution);

    var out: VertexOutput;
    out.pos = vec4<f32>(ndc, 0.0, 1.0);
    out.fill = in.color;
    out.a_dev = (in.start - uniforms.offset) * d;
    out.b_dev = (in.end - uniforms.offset) * d;
    out.half_dev = half * d;
    out.caps = in.caps;
    return out;
}

/**
 * Distance to the segment, cut flat at each butt end. MSAA can only express
 * quarter steps, which reads as a stepped diagonal where canvas draws a smooth
 * one.
 */
fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    let ab = in.b_dev - in.a_dev;
    let len = length(ab);
    let e = safeDirection(ab);
    let v = in.pos.xy - in.a_dev;
    let along = dot(v, e);
    // the difference of the two edges, so a stroke thinner than a pixel reports
    // its real width rather than the 0.6 the near edge alone would give
    let dist = length(v - e * clamp(along, 0.0, len));
    let cover = clamp(in.half_dev - dist + 0.5, 0.0, 1.0) - clamp(-in.half_dev - dist + 0.5, 0.0, 1.0);
    let behind = select(clamp(along + 0.5, 0.0, 1.0), 1.0, in.caps.x > 0.5);
    let ahead = select(clamp(len - along + 0.5, 0.0, 1.0), 1.0, in.caps.y > 0.5);
    return vec4<f32>(in.fill.rgb, in.fill.a * cover * behind * ahead);
}

${fragmentTail(blend)}
`;
