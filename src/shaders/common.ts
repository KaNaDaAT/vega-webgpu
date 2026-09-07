/**
 * WGSL every shader shares, and the machinery that specializes a shader for a
 * blend mode. Sources are built in TypeScript so a variant is a string the
 * registry composes, rather than one file per combination.
 */

/**
 * The group 0 uniform block. Every mark shader binds one, and `extra` names
 * the trailing f32 fields a particular mark adds.
 */
export function uniformBlock(...extra: string[]): string {
  const fields = ['resolution: vec2<f32>', 'offset: vec2<f32>', ...extra.map(name => `${name}: f32`)];
  return `struct Uniforms {
  ${fields.join(',\n  ')},
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;`;
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
    let c = ${colorFn}(in);
    if c.a <= 0.0 {
        discard;
    }
    return blendAdjust(c);
}`;
}

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
  return [prelude, ...Object.entries(entries).map(([name, fn]) => fragmentEntry(name, fn))].join('\n\n');
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
 * Fill and stroke each take their true share of the pixel, given the fraction
 * inside each edge. Thresholding instead would hand the whole pixel to one of
 * them, which drops the inner half of any stroke thin enough to straddle a
 * pixel boundary.
 */
export const FILL_STROKE_SHARE = `fn fillStrokeShare(fill: vec4<f32>, stroke: vec4<f32>, inner: f32, outer: f32) -> vec4<f32> {
    let fa = fill.a * inner;
    let sa = stroke.a * max(outer - inner, 0.0);
    let a = fa + sa;
    return vec4<f32>((fill.rgb * fa + stroke.rgb * sa) / max(a, 1e-6), a);
}`;

/**
 * Fraction of the pixel covered by an axis-aligned box, computed the way canvas
 * does it rather than from MSAA samples. Two abutting rects then produce
 * complementary coverage, so the seam is the faint one canvas leaves and not a
 * whole missing sample. A deliberate gap between them is preserved exactly,
 * because the geometry is untouched. lo/hi are in device pixels.
 */
export const BOX_COVERAGE = `fn boxCoverage(p: vec2<f32>, lo: vec2<f32>, hi: vec2<f32>) -> f32 {
    let cx = clamp(min(p.x - lo.x, hi.x - p.x) + 0.5, 0.0, 1.0);
    let cy = clamp(min(p.y - lo.y, hi.y - p.y) + 0.5, 0.0, 1.0);
    return cx * cy;
}`;

/** Builds one shader source. `arg` names a shape, curve or other sub-variant. */
export type ShaderBuilder = (blend: string, arg?: string) => string;
