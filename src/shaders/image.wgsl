struct Uniforms {
  resolution: vec2<f32>,
  offset: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var imageSampler: sampler;
@group(1) @binding(1) var imageTexture: texture_2d<f32>;

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
    var output: VertexOutput;
    var pos = model.position * instance.size + instance.origin - uniforms.offset;
    pos = pos / uniforms.resolution;
    pos.y = 1.0 - pos.y;
    pos = pos * 2.0 - 1.0;
    output.pos = vec4<f32>(pos, 0.0, 1.0);
    output.uv = model.position;
    output.opacity = instance.opacity;
    return output;
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(imageTexture, imageSampler, in.uv);
    return vec4<f32>(color.rgb, color.a * in.opacity);
}
