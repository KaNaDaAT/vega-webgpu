import { TO_NDC, fragmentTail, uniformBlock } from './common.js';

/**
 * Triangulated geometry with a colour per vertex, which is what the area, path
 * and shape marks all reduce to once their contours are tessellated.
 */
export const solidFillShader = (blend: string): string => `
${uniformBlock()}

${TO_NDC}

struct VertexInput {
  @location(0) position: vec2<f32>,
  @location(1) fill_color: vec4<f32>,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) fill: vec4<f32>,
}

@vertex
fn main_vertex(model: VertexInput) -> VertexOutput {
    let ndc = toNdc(model.position - uniforms.offset, uniforms.resolution);
    var output: VertexOutput;
    output.pos = vec4<f32>(ndc, 0.0, 1.0);
    output.fill = model.fill_color;
    return output;
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    return in.fill;
}

${fragmentTail(blend)}

@fragment
fn main_fragment_mask(in: VertexOutput) -> @location(0) vec4<f32> {
    // Coverage of a clip path, into the single channel target a mask is. The
    // mask already in force still applies, which is what makes a clip inside a
    // clip the intersection of the two. The rounded box is kept out of this
    // one by its caller, since every mark reading the mask cuts its own
    // corners against the same box.
    return vec4<f32>(in.fill.a * clipCoverage(in.pos.xy), 0.0, 0.0, 1.0);
}
`;
