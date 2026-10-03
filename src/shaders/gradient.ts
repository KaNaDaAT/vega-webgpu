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
    // Radial: the pencil of circles running from (x1, y1, r1) to (x2, y2, r2),
    // which is what createRadialGradient interpolates. The stop is the largest
    // t whose circle passes through the point, so it solves
    // a*t*t - 2*b*t + c = 0 for the circle centre and radius at t. Taking the
    // distance from the outer centre instead is exact only where the two are
    // concentric. Canvas draws nothing outside the cone the circles sweep,
    // which is what a negative discriminant means here.
    let m = max(wh.x, wh.y);
    let c1 = gradient.coords.xy * wh;
    let c2 = gradient.coords.zw * wh;
    let r1 = gradient.misc.y * m;
    let r2 = gradient.misc.z * m;
    let cd = c2 - c1;
    let dr = r2 - r1;
    let pd = p * wh - c1;
    let a = dot(cd, cd) - dr * dr;
    let b = dot(pd, cd) + r1 * dr;
    let c = dot(pd, pd) - r1 * r1;
    if abs(a) < 1e-6 {
        if abs(b) < 1e-6 {
            return 1.0;
        }
        return clamp(c / (2.0 * b), 0.0, 1.0);
    }
    let disc = b * b - a * c;
    if disc < 0.0 {
        return 1.0;
    }
    let root = sqrt(disc);
    let hi = (b + root) / a;
    let lo = (b - root) / a;
    // the larger t wins, but only where its circle has a radius to draw with
    if r1 + hi * dr >= 0.0 {
        return clamp(hi, 0.0, 1.0);
    }
    return clamp(lo, 0.0, 1.0);
}

// The ramp's colour at a point in canvas coordinates, spread over the bounds.
fn rampAt(world: vec2<f32>) -> vec4<f32> {
    let p = (world - gradient.bounds.xy) / max(gradient.bounds.zw, vec2<f32>(1e-6, 1e-6));
    return textureSample(stopRamp, stopSampler, vec2<f32>(gradientT(p, gradient.bounds.zw), 0.5));
}`;
