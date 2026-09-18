import { TO_NDC, fragmentTail, uniformBlock } from './common.js';

/**
 * Paints one colour through a coverage mask, over the box the mask was drawn
 * in.
 *
 * A stroke whose own bands overlap cannot be composited band by band: two
 * antialiased fringes landing on one pixel compose to more than the union
 * canvas fills once, which reads as a dark seam at every joint. The bands go
 * into the mask first, where the pass keeps the largest value on each pixel,
 * and this draws the result in a single composite.
 *
 * The mask is single sampled and the frame may not be, so the coverage is read
 * by whole texel at the pixel centre rather than sampled.
 */
export const maskCompositeShader = (blend: string): string => `
${uniformBlock('dpi')}

struct MaskParams {
  color: vec4<f32>,
  rect: vec4<f32>,
}

@group(1) @binding(0) var maskTexture: texture_2d<f32>;
@group(1) @binding(1) var<uniform> mask: MaskParams;

${TO_NDC}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
}

@vertex
fn main_vertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var corners = array(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
    );
    let p = mask.rect.xy + corners[vertexIndex] * mask.rect.zw - uniforms.offset;
    var out: VertexOutput;
    out.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0);
    return out;
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    let cover = textureLoad(maskTexture, vec2<i32>(in.pos.xy), 0).r;
    return vec4<f32>(mask.color.rgb, cover);
}

${fragmentTail(blend)}
`;
