import { TO_NDC, fragmentTail, uniformBlock } from './common.js';

/**
 * Instanced triangulated symbol shapes: one triangulated geometry per
 * (shape, size), placed and coloured per instance. Shapes with a closed form go
 * through symbolSdf and circles through symbol. Everything else comes here.
 */
export const symbolShapeShader = (blend: string): string => `
${uniformBlock()}

${TO_NDC}

struct VertexInput {
  @location(0) position: vec2<f32>,
}

struct InstanceInput {
  @location(1) center: vec2<f32>,
  @location(2) color: vec4<f32>,
  @location(3) angle: f32, // radians, clockwise (screen space)
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
}

@vertex
fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput {
    let c = cos(instance.angle);
    let s = sin(instance.angle);
    let rotated = vec2<f32>(model.position.x * c - model.position.y * s, model.position.x * s + model.position.y * c);
    let ndc = toNdc(rotated + instance.center - uniforms.offset, uniforms.resolution);
    var output: VertexOutput;
    output.pos = vec4<f32>(ndc, 0.0, 1.0);
    output.color = instance.color;
    return output;
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    return in.color;
}

${fragmentTail(blend)}
`;
