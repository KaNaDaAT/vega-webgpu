/**
 * WGSL every shader shares, and the machinery that specializes a shader for a
 * blend mode. Sources are built in TypeScript so a variant is a string the
 * registry composes, rather than one file per combination.
 */

/**
 * The group 0 uniform block every mark shader binds, laid out the way
 * BufferManager writes it, with `dpi()` for the shaders that measure in device
 * pixels.
 */
export function uniformBlock(): string {
  return `struct Uniforms {
  resolution: vec2<f32>,
  offset: vec2<f32>,
  // the clipping box and its corner radii, both in device pixels
  clip: vec4<f32>,
  clipRadii: vec4<f32>,
  // x is 1 where a clip path has a coverage mask to be read, 0 otherwise
  clipMask: vec4<f32>,
  dpi: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Coverage of the clip path, where the clip is one. A 1x1 placeholder is bound
// when it is not, and the clipMask flag is what stops anything reading it.
@group(0) @binding(1) var clipMaskTexture: texture_2d<f32>;

// device pixels per logical pixel, kept off zero for the shaders dividing by it
fn dpi() -> f32 {
    return max(uniforms.dpi, 0.001);
}`;
}

/** Canvas pixels to clip space. y flips because canvas coordinates grow down. */
export const TO_NDC = `fn toNdc(p: vec2<f32>, resolution: vec2<f32>) -> vec2<f32> {
    var q = p / resolution;
    q.y = 1.0 - q.y;
    return q * 2.0 - 1.0;
}`;

/**
 * How each blend mode wants its source colour, given straight alpha.
 *
 * Canvas applies a blend as `dst * (1 - a) + a * f(src, dst)`, so the source
 * has to be weighted by its own alpha somewhere. WebGPU's factors cannot do it
 * and reach the destination at the same time, so the shader does it instead.
 * For multiply and screen that makes the result exact at every alpha: the
 * premultiplied colour paired with their factors expands to canvas's formula.
 *
 * min and max have no term to interpolate with, so darken and lighten stay
 * exact only at alpha 0 and 1. Weighting towards the operation's identity
 * (white for min, black for max) at least leaves an antialiased edge alone,
 * where an unweighted colour applies the full blend to a fragment that barely
 * covers the pixel.
 */
const SOURCE_COLOR: Record<string, string> = {
  normal: 'c',
  multiply: 'vec4<f32>(c.rgb * c.a, c.a)',
  screen: 'vec4<f32>(c.rgb * c.a, c.a)',
  darken: 'vec4<f32>(mix(vec3<f32>(1.0), c.rgb, c.a), c.a)',
  lighten: 'vec4<f32>(c.rgb * c.a, c.a)',
};

function fragmentEntry(entryPoint: string, colorFn: string): string {
  return `@fragment
fn ${entryPoint}(in: VertexOutput) -> @location(0) vec4<f32> {
    let clipCov = clipCoverage(in.pos.xy);
    if clipCov <= 0.0 {
        discard;
    }
    let raw = ${colorFn}(in);
    let c = vec4<f32>(raw.rgb, raw.a * clipCov);
    if c.a <= 0.0 {
        discard;
    }
    return blendAdjust(c);
}`;
}

/**
 * How much of a fragment the clip's rounded corners leave.
 *
 * A clip is a scissor rect, which is exact for a plain box and cannot express
 * the rounded rectangle canvas clips a group to when it has a cornerRadius.
 * The scissor still does the rejecting, so this only has to cut the four
 * corners, and it is skipped outright when there is no radius to cut.
 *
 * Coverage rather than a discard, because canvas antialiases the edge of a
 * clip path. Cutting on a test instead leaves the corner stepped, which reads
 * 93 against canvas where the fraction reads 25.
 */
const INSIDE_CLIP = `fn clipCoverage(p: vec2<f32>) -> f32 {
    var cov = 1.0;
    // A clip that is a path is a mask rather than a box. It is single sampled
    // and the frame may not be, so it is read by whole texel at the pixel
    // centre rather than sampled, the way the stroke mask composite reads its.
    if uniforms.clipMask.x > 0.5 {
        cov = textureLoad(clipMaskTexture, vec2<i32>(p), 0).r;
        if cov <= 0.0 {
            return 0.0;
        }
    }
    let r = uniforms.clipRadii;
    if r.x <= 0.0 && r.y <= 0.0 && r.z <= 0.0 && r.w <= 0.0 {
        return cov;
    }
    let lo = uniforms.clip.xy;
    let hi = lo + uniforms.clip.zw;
    var c = vec2<f32>(0.0, 0.0);
    var radius = 0.0;
    if p.x < lo.x + r.x && p.y < lo.y + r.x {
        c = lo + vec2<f32>(r.x, r.x);
        radius = r.x;
    } else if p.x > hi.x - r.y && p.y < lo.y + r.y {
        c = vec2<f32>(hi.x - r.y, lo.y + r.y);
        radius = r.y;
    } else if p.x > hi.x - r.z && p.y > hi.y - r.z {
        c = hi - vec2<f32>(r.z, r.z);
        radius = r.z;
    } else if p.x < lo.x + r.w && p.y > hi.y - r.w {
        c = vec2<f32>(lo.x + r.w, hi.y - r.w);
        radius = r.w;
    } else {
        return cov;
    }
    return cov * clamp(radius + 0.5 - distance(p, c), 0.0, 1.0);
}`;

/**
 * Every shader ends this way: `blendAdjust` for the mode, then one fragment
 * entry point per colour function. A colour function returns straight alpha and
 * the entry point drops a fragment covering nothing before weighting the rest.
 *
 * The discard is not an optimization. Marks grow their geometry past the shape
 * so an analytic edge is not clipped, and those empty fragments still change
 * the destination under a multiply or a min.
 */
export function fragmentTail(blend: string, entries: Record<string, string> = DEFAULT_ENTRY): string {
  const prelude = `fn blendAdjust(c: vec4<f32>) -> vec4<f32> {
    return ${SOURCE_COLOR[blend] ?? SOURCE_COLOR.normal};
}`;
  return [INSIDE_CLIP, prelude, ...Object.entries(entries).map(([name, fn]) => fragmentEntry(name, fn))].join('\n\n');
}

const DEFAULT_ENTRY = { main_fragment: 'fragmentColor' };

/** A segment direction that survives a zero-length segment, and its normal. */
export const SEGMENT_NORMAL = `fn safeDirection(d: vec2<f32>) -> vec2<f32> {
    return select(vec2<f32>(1.0, 0.0), normalize(d), length(d) > 1e-9);
}

fn normalAt(d: vec2<f32>) -> vec2<f32> {
    let dir = safeDirection(d);
    return vec2<f32>(-dir.y, dir.x);
}`;

/**
 * The stroke over the fill, each taking its true share of the pixel.
 * Thresholding instead would hand the whole pixel to one of them, which drops
 * the inner half of any stroke thin enough to straddle a pixel boundary.
 *
 * Over, not side by side. Canvas fills the whole shape and then strokes on top,
 * so a stroke that is translucent shows the fill through it and one that is
 * fully transparent leaves the fill untouched. Giving the stroke band to the
 * stroke alone instead ate a ring off every such shape: a vega legend swatch is
 * `stroke: transparent` with a width of 1.5, which came out 8px across where
 * canvas draws 10. An opaque stroke covers the fill under it either way, so
 * nothing that was already right moves.
 */
export const FILL_STROKE_SHARE = `fn fillStrokeShare(fill: vec4<f32>, stroke: vec4<f32>, fillCov: f32, strokeCov: f32) -> vec4<f32> {
    let sa = stroke.a * strokeCov;
    let fa = fill.a * fillCov * (1.0 - sa);
    let a = sa + fa;
    return vec4<f32>((stroke.rgb * sa + fill.rgb * fa) / max(a, 1e-6), a);
}`;

/**
 * Fraction of the pixel covered by an axis-aligned box, computed the way canvas
 * does it rather than from MSAA samples. Two abutting rects then produce
 * complementary coverage, so the seam is the faint one canvas leaves and not a
 * whole missing sample. A deliberate gap between them is preserved exactly,
 * because the geometry is untouched. lo/hi are in device pixels.
 *
 * Taking the difference of the two edges rather than the distance to the
 * nearer one is what keeps a box thinner than a pixel honest: the near edge
 * alone reports a 0.2 px border as 0.6 covered.
 */
export const BOX_COVERAGE = `fn boxCoverage(p: vec2<f32>, lo: vec2<f32>, hi: vec2<f32>) -> f32 {
    let cx = clamp(hi.x - p.x + 0.5, 0.0, 1.0) - clamp(lo.x - p.x + 0.5, 0.0, 1.0);
    let cy = clamp(hi.y - p.y + 0.5, 0.0, 1.0) - clamp(lo.y - p.y + 0.5, 0.0, 1.0);
    return cx * cy;
}`;

/** The two triangles of a unit square, for a vertex stage that indexes its corners. */
export const UNIT_QUAD = `array(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    )`;

/**
 * Straight colour out of a premultiplied texel. Textures stay premultiplied so
 * filtering does not darken an edge, and the blend state takes straight alpha.
 */
export const UNPREMULTIPLY = `fn unpremultiply(c: vec4<f32>) -> vec3<f32> {
    return c.rgb / max(c.a, 1e-6);
}`;

/** Builds one shader source. `arg` names a shape, curve or other sub-variant. */
export type ShaderBuilder = (blend: string, arg?: string) => string;
