struct Uniforms {
  resolution: vec2<f32>,
  offset: vec2<f32>,
  opacity: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var texSampler: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

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
  var p = in.position - uniforms.offset;
  p = p / uniforms.resolution;
  p.y = 1.0 - p.y;
  p = p * 2.0 - 1.0;
  output.pos = vec4<f32>(p, 0.0, 1.0);
  output.uv = in.uv;
  return output;
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
  // The glyph texture is rasterized with the fill/stroke colors baked in
  // (straight alpha). Only the item opacity is applied here.
  let c = textureSample(tex, texSampler, in.uv);
  return vec4<f32>(c.rgb, c.a * uniforms.opacity);
}
