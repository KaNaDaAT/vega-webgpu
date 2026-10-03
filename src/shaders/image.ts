import { TO_NDC, UNPREMULTIPLY, fragmentTail, uniformBlock } from './common.js';

/** One instanced quad per image, sampling the decoded bitmap. */
export const imageShader = (blend: string): string => `
${uniformBlock()}

@group(1) @binding(0) var imageSampler: sampler;
@group(1) @binding(1) var imageTexture: texture_2d<f32>;

${TO_NDC}

struct VertexInput {
  @location(0) position: vec2<f32>, // unit quad, 0..1
}

struct InstanceInput {
  @location(1) origin: vec2<f32>,
  @location(2) size: vec2<f32>,
  @location(3) opacity: f32,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) opacity: f32,
}

@vertex
fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput {
    let p = model.position * instance.size + instance.origin - uniforms.offset;
    var output: VertexOutput;
    output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0);
    output.uv = model.position;
    output.opacity = instance.opacity;
    return output;
}

${UNPREMULTIPLY}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    let color = textureSample(imageTexture, imageSampler, in.uv);
    return vec4<f32>(unpremultiply(color), color.a * in.opacity);
}

${fragmentTail(blend)}
`;
