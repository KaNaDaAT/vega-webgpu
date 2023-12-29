struct Uniforms {
    resolution: vec2<f32>,
    offset: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) center: vec2<f32>,
    @location(2) scale: vec2<f32>,
    @location(3) stroke_color: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(1) stroke: vec4<f32>,
}

@vertex
fn main_vertex(in: VertexInput) -> VertexOutput {
    var output : VertexOutput;
    var u = uniforms.resolution;
    var x_width_offset = in.scale.x;
    var y_width_offset = in.scale.y;
    if x_width_offset > 1.0 {
      x_width_offset = 0.0;
    }
    if y_width_offset > 1.0 {
      y_width_offset = 0.0;
    }
    var pos = in.position * in.scale  + in.center - uniforms.offset - vec2<f32>(x_width_offset / 2.0, y_width_offset / 2.0);
    pos = pos / uniforms.resolution;
    pos.y = 1.0 - pos.y;
    pos = pos * 2.0 - 1.0;
    output.pos = vec4<f32>(pos, 0.0, 1.0);
    output.stroke = in.stroke_color;
    return output;
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    return in.stroke;
}
