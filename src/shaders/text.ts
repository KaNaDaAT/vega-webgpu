import { TO_NDC, fragmentTail, uniformBlock } from './common.js';

/**
 * One quad per label, sampling the sub-rect it was packed into on the atlas.
 * The glyph is rasterized upright, so a rotated label turns its quad about the
 * anchor instead.
 */
export const textShader = (blend: string): string => `
${uniformBlock()}

@group(1) @binding(0) var texSampler: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

${TO_NDC}

struct VertexInput {
  // quad in logical pixels, as x1, y1, x2, y2
  @location(0) rect: vec4<f32>,
  // sub-rect of the atlas, as u1, v1, u2, v2
  @location(1) uv: vec4<f32>,
  // anchor the quad turns about, then cos and sin of the angle
  @location(2) turn: vec4<f32>,
  @location(3) opacity: f32,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) opacity: f32,
}

@vertex
fn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var corners = array(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    );
    let c = corners[vertexIndex];
    var p = mix(in.rect.xy, in.rect.zw, c);
    if (in.turn.w != 0.0 || in.turn.z != 1.0) {
        let d = p - in.turn.xy;
        p = in.turn.xy + vec2<f32>(d.x * in.turn.z - d.y * in.turn.w, d.x * in.turn.w + d.y * in.turn.z);
    }

    var output: VertexOutput;
    output.pos = vec4<f32>(toNdc(p - uniforms.offset, uniforms.resolution), 0.0, 1.0);
    output.uv = mix(in.uv.xy, in.uv.zw, c);
    output.opacity = in.opacity;
    return output;
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    // The glyph texture is rasterized with the fill/stroke colors baked in and
    // kept premultiplied, so filtering does not darken an edge. The blend state
    // expects straight alpha, so divide it back out. Only the item opacity is
    // applied here.
    let c = textureSample(tex, texSampler, in.uv);
    let rgb = c.rgb / max(c.a, 1e-6);
    return vec4<f32>(rgb, c.a * in.opacity);
}

${fragmentTail(blend)}
`;
