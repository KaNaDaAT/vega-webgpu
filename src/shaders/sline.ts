import { TO_NDC, blendPrelude, fragmentEntry, uniformBlock } from './common.js';

/**
 * One quad per line segment instance, with the coverage of a butt capped
 * segment computed analytically. Dashes, dashed rect borders and diagonal rules
 * all come through here.
 */
export const slineShader = (blend: string): string => `
${uniformBlock('dpi')}

${TO_NDC}

struct VertexInput {
    @location(0) start: vec2<f32>,
    @location(1) end: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) stroke_width: f32,
}

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) fill: vec4<f32>,
    // segment ends and half width in device pixels, for analytic coverage
    @location(1) a_dev: vec2<f32>,
    @location(2) b_dev: vec2<f32>,
    @location(3) half_dev: f32,
}

@vertex
fn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    let d = max(uniforms.dpi, 0.001);
    // normalize() on a zero-length segment returns NaN
    let delta = in.end - in.start;
    let seg_len = length(delta);
    let direction = select(vec2<f32>(1.0, 0.0), delta / seg_len, seg_len > 1e-6);
    let normal = vec2<f32>(-direction.y, direction.x);

    // Grow the quad by one device pixel so the falloff is not clipped, which
    // leaves every pixel the segment touches fully rasterized.
    let pad = 1.0 / d;
    let side = normal * (in.stroke_width * 0.5 + pad);
    let ahead = direction * pad;

    let p1 = in.start - side - ahead;
    let p2 = in.start + side - ahead;
    let p3 = in.end - side + ahead;
    let p4 = in.end + side + ahead;

    var vertices = array(p1, p2, p3, p4, p2, p3);
    let ndc = toNdc(vertices[vertexIndex] - uniforms.offset, uniforms.resolution);

    var out: VertexOutput;
    out.pos = vec4<f32>(ndc, 0.0, 1.0);
    out.fill = in.color;
    out.a_dev = (in.start - uniforms.offset) * d;
    out.b_dev = (in.end - uniforms.offset) * d;
    out.half_dev = in.stroke_width * 0.5 * d;
    return out;
}

/**
 * Coverage across the stroke times coverage along it, the separable box model
 * rect and rule use. MSAA can only express quarter steps, which reads as a
 * stepped diagonal where canvas draws a smooth one.
 */
fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    let ab = in.b_dev - in.a_dev;
    let len = length(ab);
    let e = select(vec2<f32>(1.0, 0.0), ab / max(len, 1e-6), len > 1e-6);
    let v = in.pos.xy - in.a_dev;
    let along = dot(v, e);
    let perp = abs(v.y * e.x - v.x * e.y);
    let across = clamp(in.half_dev - perp + 0.5, 0.0, 1.0);
    let ends = clamp(min(along, len - along) + 0.5, 0.0, 1.0);
    return vec4<f32>(in.fill.rgb, in.fill.a * across * ends);
}

${blendPrelude(blend)}

${fragmentEntry('main_fragment', 'fragmentColor')}
`;
