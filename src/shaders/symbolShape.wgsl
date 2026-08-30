// Instanced triangulated symbol shapes: one triangulated geometry per
// (shape, size), placed and colored per instance. Circles use the analytic
// symbol.wgsl shader instead. Everything else comes through here.
struct Uniforms {
  resolution: vec2<f32>,
  offset: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

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
  var pos = rotated + instance.center - uniforms.offset;
  pos = pos / uniforms.resolution;
  pos.y = 1.0 - pos.y;
  pos = pos * 2.0 - 1.0;
  var output: VertexOutput;
  output.pos = vec4<f32>(pos, 0.0, 1.0);
  output.color = instance.color;
  return output;
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
  return in.color;
}
