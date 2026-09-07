import { TO_NDC, blendPrelude, fragmentEntry, uniformBlock } from './common.js';

/** Glyph quads sampling the text atlas rasterized by the 2D scratch canvas. */
export const textShader = (blend: string): string => `
${uniformBlock('opacity')}

@group(1) @binding(0) var texSampler: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

${TO_NDC}

struct VertexInput {
  @location(0) position: vec2<f32>,
  @location(1) uv: vec2<f32>,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn main_vertex(in: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.pos = vec4<f32>(toNdc(in.position - uniforms.offset, uniforms.resolution), 0.0, 1.0);
    output.uv = in.uv;
    return output;
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    // The glyph texture is rasterized with the fill/stroke colors baked in and
    // kept premultiplied, so filtering does not darken an edge. The blend state
    // expects straight alpha, so divide it back out. Only the item opacity is
    // applied here.
    let c = textureSample(tex, texSampler, in.uv);
    let rgb = c.rgb / max(c.a, 1e-6);
    return vec4<f32>(rgb, c.a * uniforms.opacity);
}

${blendPrelude(blend)}

${fragmentEntry('main_fragment', 'fragmentColor')}
`;
