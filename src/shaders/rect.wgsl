struct Uniforms {
  resolution: vec2<f32>,
  offset: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

struct VertexInput {
  @location(0) position: vec2<f32>,
}

struct InstanceInput {
  @location(1) center: vec2<f32>,
  @location(2) scale: vec2<f32>,
  @location(3) fill_color: vec4<f32>,
  @location(4) stroke_color: vec4<f32>,
  @location(5) strokewidth: f32,
  @location(6) corner_radii: vec4<f32>,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) fill: vec4<f32>,
  @location(2) stroke: vec4<f32>,
  @location(3) strokewidth: f32,
  @location(4) corner_radii: vec4<f32>,
  @location(5) scale: vec2<f32>,
}

@vertex
fn main_vertex(
    model: VertexInput,
    instance: InstanceInput
) -> VertexOutput {
    var output: VertexOutput;
    var u = uniforms.resolution;
    var scale = instance.scale + vec2<f32>(instance.strokewidth, instance.strokewidth);
    var pos = model.position * scale + instance.center - uniforms.offset - vec2<f32>(instance.strokewidth, instance.strokewidth) / 2.0;
    pos = pos / u;
    pos.y = 1.0 - pos.y;
    pos = pos * 2.0 - 1.0;
    output.pos = vec4<f32>(pos, 0.0, 1.0);
    output.uv = vec2<f32>(model.position.x, 1.0 - model.position.y);
    output.fill = instance.fill_color;
    output.stroke = instance.stroke_color;
    output.strokewidth = instance.strokewidth;
    output.corner_radii = instance.corner_radii;
    output.scale = instance.scale;
    return output;
}

// Signed distance to the rect edge with per-corner radii.
// p is centered on the rect in pixels (y up), b is the half extent.
// corner_radii = (topRight, bottomRight, bottomLeft, topLeft).
fn sdRoundedRect(p: vec2<f32>, b: vec2<f32>, radii: vec4<f32>) -> f32 {
    var r = select(
        select(radii.z, radii.w, p.y > 0.0), // left: TL above center, BL below
        select(radii.y, radii.x, p.y > 0.0), // right: TR above center, BR below
        p.x > 0.0,
    );
    r = min(r, min(b.x, b.y));
    let q = abs(p) - b + vec2<f32>(r, r);
    return length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// Blends fill and stroke along the rounded edge. The stroke straddles the
// nominal edge like canvas strokes do. `aa` is the antialiasing width.
fn roundedRectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> {
    let p = (in.uv - vec2<f32>(0.5, 0.5)) * (in.scale + vec2<f32>(in.strokewidth, in.strokewidth));
    let d = sdRoundedRect(p, in.scale * 0.5, in.corner_radii);
    let half_sw = in.strokewidth * 0.5;
    let aa = 0.75;

    let strokeMix = smoothstep(-half_sw - aa, -half_sw + aa, d);
    let coverage = 1.0 - smoothstep(half_sw - aa, half_sw + aa, d);
    var col = mix(fill, in.stroke, strokeMix);
    return vec4<f32>(col.rgb, col.a * coverage);
}

fn straightRectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> {
    var col = fill;
    // uv spans the quad enlarged by strokewidth (see main_vertex), so the
    // stroke band fraction must divide by that enlarged size to keep the
    // stroke exactly strokewidth px wide, centered on the rect edge.
    let sw: vec2<f32> = vec2<f32>(in.strokewidth, in.strokewidth) / (in.scale + vec2<f32>(in.strokewidth, in.strokewidth));
    if in.uv.x < sw.x || in.uv.x > 1.0 - sw.x {
        col = in.stroke;
    }
    if in.uv.y < sw.y || in.uv.y > 1.0 - sw.y {
        col = in.stroke;
    }
    return col;
}

fn maxRadius(radii: vec4<f32>) -> f32 {
    return max(max(radii.x, radii.y), max(radii.z, radii.w));
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    if maxRadius(in.corner_radii) <= 0.0 {
        return straightRectColor(in, in.fill);
    }
    return roundedRectColor(in, in.fill);
}

// Gradient-filled rects: the fill is sampled from a baked stop ramp.
// coords = (x1, y1, x2, y2) normalized to the rect (y down),
// misc = (kind, r1, r2, unused). kind: 1 = linear, 2 = radial.
struct GradientParams {
  coords: vec4<f32>,
  bounds: vec4<f32>,
  misc: vec4<f32>,
}

@group(1) @binding(0) var stopSampler: sampler;
@group(1) @binding(1) var stopRamp: texture_2d<f32>;
@group(1) @binding(2) var<uniform> gradient: GradientParams;

// p is normalized to the rect, wh is the rect size in pixels.
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
fn main_fragment_gradient(in: VertexOutput) -> @location(0) vec4<f32> {
    // un-flip: gradient coordinates run top-down like canvas coordinates
    let p = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
    let t = gradientT(p, in.scale);
    let sample = textureSample(stopRamp, stopSampler, vec2<f32>(t, 0.5));
    let fill = vec4<f32>(sample.rgb, sample.a * in.fill.a);

    if maxRadius(in.corner_radii) <= 0.0 {
        return straightRectColor(in, fill);
    }
    return roundedRectColor(in, fill);
}
