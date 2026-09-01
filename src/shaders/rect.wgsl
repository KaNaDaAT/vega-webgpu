struct Uniforms {
  resolution: vec2<f32>,
  offset: vec2<f32>,
  dpi: f32,
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
  // true rect edges in device pixels, for analytic coverage
  @location(6) lo_dev: vec2<f32>,
  @location(7) hi_dev: vec2<f32>,
}

@vertex
fn main_vertex(
    model: VertexInput,
    instance: InstanceInput
) -> VertexOutput {
    var output: VertexOutput;
    let d = max(uniforms.dpi, 0.001);
    let sw = vec2<f32>(instance.strokewidth, instance.strokewidth);
    let size = instance.scale + sw;
    let lo = instance.center - uniforms.offset - sw / 2.0;
    let hi = lo + size;

    // Grow the quad by one device pixel so the analytic falloff below is not
    // clipped. Every pixel the rect touches is then fully rasterized, so MSAA
    // adds no edge coverage of its own and the fragment alpha does all of it.
    let pad = vec2<f32>(1.0, 1.0) / d;
    let p = mix(lo - pad, hi + pad, model.position);

    var ndc = p / uniforms.resolution;
    ndc.y = 1.0 - ndc.y;
    ndc = ndc * 2.0 - 1.0;
    output.pos = vec4<f32>(ndc, 0.0, 1.0);

    // uv is relative to the true rect, so it runs slightly outside 0..1 in the pad
    let uv = (p - lo) / max(size, vec2<f32>(1e-6, 1e-6));
    output.uv = vec2<f32>(uv.x, 1.0 - uv.y);
    output.fill = instance.fill_color;
    output.stroke = instance.stroke_color;
    output.strokewidth = instance.strokewidth;
    output.corner_radii = instance.corner_radii;
    output.scale = instance.scale;
    output.lo_dev = lo * d;
    output.hi_dev = hi * d;
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

/**
 * Fraction of the pixel covered by an axis-aligned box, computed the way canvas
 * does it rather than from MSAA samples. Two abutting rects then produce
 * complementary coverage, so the seam is the faint one canvas leaves and not a
 * whole missing sample. A deliberate gap between rects is preserved exactly,
 * because the geometry is untouched. lo/hi are in device pixels.
 */
fn boxCoverage(p: vec2<f32>, lo: vec2<f32>, hi: vec2<f32>) -> f32 {
    let cx = clamp(min(p.x - lo.x, hi.x - p.x) + 0.5, 0.0, 1.0);
    let cy = clamp(min(p.y - lo.y, hi.y - p.y) + 0.5, 0.0, 1.0);
    return cx * cy;
}

/**
 * Fill and stroke each get their true share of the pixel. Thresholding uv
 * instead would hand the whole pixel to one of them, which drops the inner
 * half of any stroke thin enough to straddle a pixel boundary.
 */
fn straightRectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> {
    let p = in.pos.xy;
    let sw = vec2<f32>(in.strokewidth, in.strokewidth) * max(uniforms.dpi, 0.001);
    let outer = boxCoverage(p, in.lo_dev, in.hi_dev);
    let inner = boxCoverage(p, in.lo_dev + sw, in.hi_dev - sw);
    // the fill and stroke areas are disjoint inside the pixel, so alphas add
    let fa = fill.a * inner;
    let sa = in.stroke.a * max(outer - inner, 0.0);
    let a = fa + sa;
    let rgb = (fill.rgb * fa + in.stroke.rgb * sa) / max(a, 1e-6);
    return vec4<f32>(rgb, a);
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
