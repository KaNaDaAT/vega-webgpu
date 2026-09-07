import { TO_NDC, fragmentTail, uniformBlock } from './common.js';

/**
 * Triangulated geometry with a colour per vertex, which is what the area, path
 * and shape marks all reduce to once their contours are tessellated.
 */
export const solidFillShader = (blend: string): string => `
${uniformBlock()}

${TO_NDC}

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) fill_color: vec4<f32>,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) fill: vec4<f32>,
}

@vertex
fn main_vertex(model: VertexInput) -> VertexOutput {
    let ndc = toNdc(model.position.xy - uniforms.offset, uniforms.resolution);
    var output: VertexOutput;
    output.pos = vec4<f32>(ndc, model.position.z + 0.5, 1.0);
    output.uv = ndc;
    output.fill = model.fill_color;
    return output;
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    return in.fill;
}

${fragmentTail(blend)}
`;
