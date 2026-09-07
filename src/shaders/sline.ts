import { TO_NDC, blendPrelude, fragmentEntry, uniformBlock } from './common.js';

/**
 * One quad per line segment instance, with no edge falloff of its own. Dashes,
 * dashed rect borders and diagonal rules all come through here.
 */
export const slineShader = (blend: string): string => `
${uniformBlock()}

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
}

@vertex
fn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    // normalize() on a zero-length segment returns NaN
    let delta = in.end - in.start;
    let seg_len = length(delta);
    let direction = select(vec2<f32>(1.0, 0.0), delta / seg_len, seg_len > 1e-6);
    let normal = vec2<f32>(-direction.y, direction.x);
    let offset = normal * (in.stroke_width * 0.5);

    let p1 = in.start - offset;
    let p2 = in.start + offset;
    let p3 = in.end - offset;
    let p4 = in.end + offset;

    var vertices = array(p1, p2, p3, p4, p2, p3);
    let ndc = toNdc(vertices[vertexIndex] - uniforms.offset, uniforms.resolution);

    var out: VertexOutput;
    out.pos = vec4<f32>(ndc, 0.0, 1.0);
    out.fill = in.color;
    return out;
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    return in.fill;
}

${blendPrelude(blend)}

${fragmentEntry('main_fragment', 'fragmentColor')}
`;
