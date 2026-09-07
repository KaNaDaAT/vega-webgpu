import { TO_NDC, fragmentTail, uniformBlock } from './common.js';
import { GRADIENT_BLOCK } from './gradient.js';

/**
 * Triangulated geometry filled from a gradient ramp. The vertex colour carries
 * only the computed fill opacity, the ramp supplies the rest.
 */
export const gradientFillShader = (blend: string): string => `
${uniformBlock()}

${GRADIENT_BLOCK}

${TO_NDC}

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) fill_color: vec4<f32>,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) world: vec2<f32>,
  @location(1) fill: vec4<f32>,
}

@vertex
fn main_vertex(model: VertexInput) -> VertexOutput {
    let ndc = toNdc(model.position.xy - uniforms.offset, uniforms.resolution);
    var output: VertexOutput;
    output.pos = vec4<f32>(ndc, model.position.z + 0.5, 1.0);
    output.world = model.position.xy;
    output.fill = model.fill_color;
    return output;
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    let normalized = (in.world - gradient.bounds.xy) / max(gradient.bounds.zw, vec2<f32>(1e-6, 1e-6));
    let t = gradientT(normalized, gradient.bounds.zw);
    let sample = textureSample(stopRamp, stopSampler, vec2<f32>(t, 0.5));
    return vec4<f32>(sample.rgb, sample.a * in.fill.a);
}

${fragmentTail(blend)}
`;
