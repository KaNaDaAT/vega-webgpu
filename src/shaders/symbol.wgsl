struct Uniforms {
  resolution: vec2<f32>,
  offset: vec2<f32>,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VertexInput {
  @location(0) position: vec2<f32>,
}

struct InstanceInput {
  @location(1) center: vec2<f32>,
  @location(2) radius: f32,
  @location(3) fill_color: vec4<f32>,
  @location(4) stroke_color: vec4<f32>,
  @location(5) stroke_width: f32,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) fill: vec4<f32>,
  @location(2) stroke_color: vec4<f32>,
  @location(3) radius: f32,
  @location(4) stroke_width: f32,
  @location(5) geom_radius: f32,
}

// Antialiasing half-width (px) and extra geometry padding so the analytic
// circle edge fades out inside the tessellated geometry.
const aa = 0.75;
const pad = 1.0;

@vertex
fn main_vertex(
    model: VertexInput,
    instance: InstanceInput
) -> VertexOutput {
    var output: VertexOutput;
    // The stroke straddles the fill radius, so the geometry must reach the
    // outer stroke edge (radius + stroke_width/2) plus AA padding.
    let geom_radius = instance.radius + instance.stroke_width * 0.5 + pad;
    var pos = model.position * geom_radius + instance.center - uniforms.offset;
    pos = pos / uniforms.resolution;
    pos.y = 1.0 - pos.y;
    pos = pos * 2.0 - 1.0;
    output.pos = vec4<f32>(pos, 0.0, 1.0);
    output.uv = model.position * 0.5 + vec2<f32>(0.5, 0.5);
    output.fill = instance.fill_color;
    output.stroke_color = instance.stroke_color;
    output.radius = instance.radius;
    output.stroke_width = instance.stroke_width;
    output.geom_radius = geom_radius;
    return output;
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    // distance from the symbol center, in pixels
    let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0 * in.geom_radius;
    let half_sw = in.stroke_width * 0.5;
    let outer = in.radius + half_sw;
    let inner = in.radius - half_sw;
    // coverage fades at the outer edge, stroke replaces fill outside `inner`
    let coverage = 1.0 - smoothstep(outer - aa, outer + aa, d);
    let strokeMix = smoothstep(inner - aa, inner + aa, d);
    let col = mix(in.fill, in.stroke_color, strokeMix);
    return vec4<f32>(col.rgb, col.a * coverage);
}
