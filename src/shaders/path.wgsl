struct Uniforms {
  resolution: vec2<f32>,
  offset: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

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
fn main_vertex(
    model: VertexInput
) -> VertexOutput {
    var output: VertexOutput;
    var pos = model.position.xy - uniforms.offset;
    pos = pos / uniforms.resolution;
    pos.y = 1.0 - pos.y;
    pos = pos * 2.0 - 1.0;
    output.pos = vec4<f32>(pos, model.position.z + 0.5, 1.0);
    output.uv = pos;
    output.fill = model.fill_color;
    return output;
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    // A fragment with no coverage must not reach the blend state: under a
    // multiply or min it would still change the destination.
    if in.fill.a <= 0.0 {
        discard;
    }
    return in.fill;
}
