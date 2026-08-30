struct Uniforms {
  resolution: vec2<f32>,
  offset: vec2<f32>,
}

// coords = (x1, y1, x2, y2) in normalized item space,
// bounds = (x, y, w, h) of the item in canvas coordinates,
// misc = (kind, r1, r2, unused). kind: 1 = linear, 2 = radial.
struct GradientParams {
  coords: vec4<f32>,
  bounds: vec4<f32>,
  misc: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var stopSampler: sampler;
@group(1) @binding(1) var stopRamp: texture_2d<f32>;
@group(1) @binding(2) var<uniform> gradient: GradientParams;

struct VertexInput {
  @location(0) position: vec3<f32>,
  // vertex color carries only the computed fill opacity in .a
  @location(1) fill_color: vec4<f32>,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) world: vec2<f32>,
  @location(1) fill: vec4<f32>,
}

@vertex
fn main_vertex(model: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    var pos = model.position.xy - uniforms.offset;
    pos = pos / uniforms.resolution;
    pos.y = 1.0 - pos.y;
    pos = pos * 2.0 - 1.0;
    output.pos = vec4<f32>(pos, model.position.z + 0.5, 1.0);
    output.world = model.position.xy;
    output.fill = model.fill_color;
    return output;
}

// p is normalized to the item bounds, wh is the bounds size in pixels.
// Linear gradients evaluate in normalized space (matching vega's canvas
// renderer). Radial gradients are circular in pixel space with radii
// scaled by max(w, h).
fn gradientT(p: vec2<f32>, wh: vec2<f32>) -> f32 {
    if gradient.misc.x < 1.5 {
        let a = gradient.coords.xy;
        let b = gradient.coords.zw;
        let ab = b - a;
        let len2 = max(dot(ab, ab), 1e-6);
        return clamp(dot(p - a, ab) / len2, 0.0, 1.0);
    }
    // radial: concentric-circle approximation around (x2, y2)
    let m = max(wh.x, wh.y);
    let c = gradient.coords.zw * wh;
    let r1 = gradient.misc.y * m;
    let r2 = gradient.misc.z * m;
    return clamp((distance(p * wh, c) - r1) / max(r2 - r1, 1e-6), 0.0, 1.0);
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let normalized = (in.world - gradient.bounds.xy) / max(gradient.bounds.zw, vec2<f32>(1e-6, 1e-6));
    let t = gradientT(normalized, gradient.bounds.zw);
    let sample = textureSample(stopRamp, stopSampler, vec2<f32>(t, 0.5));
    return vec4<f32>(sample.rgb, sample.a * in.fill.a);
}
