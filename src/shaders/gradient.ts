/**
 * The gradient ramp bound at group 1, shared by the marks that fill from one.
 * The stops are baked into a 1D texture on the CPU, so a gradient costs a
 * sample rather than a stop loop per fragment.
 */
export const GRADIENT_BLOCK = `// coords = (x1, y1, x2, y2) in normalized item space,
// bounds = (x, y, w, h) of the item in canvas coordinates,
// misc = (kind, r1, r2, unused). kind: 1 = linear, 2 = radial.
struct GradientParams {
  coords: vec4<f32>,
  bounds: vec4<f32>,
  misc: vec4<f32>,
}

@group(1) @binding(0) var stopSampler: sampler;
@group(1) @binding(1) var stopRamp: texture_2d<f32>;
@group(1) @binding(2) var<uniform> gradient: GradientParams;

// p is normalized to the item, wh is the item size in pixels. Linear gradients
// evaluate in normalized space, matching vega's canvas renderer. Radial ones
// are circular in pixel space with radii scaled by max(w, h).
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
}`;
