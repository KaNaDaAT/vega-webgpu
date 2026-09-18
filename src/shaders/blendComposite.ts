/**
 * What a mode does, as the CSS compositing spec writes it.
 *
 * `blend` is `B(cb, cs)`, how the two colours combine where both cover. `fa`
 * and `fb` are the coverage weights, which is what separates a blend mode from
 * a compositing operator: a blend keeps source over's own pair and only changes
 * B, an operator keeps B at the source and changes the pair. `erases` says the
 * operator does something to the frame where the source is absent, so the
 * composite has to run on those pixels rather than discard them.
 *
 * Adding a mode is an entry here, since everything around it is the same.
 */
interface Mode {
  blend?: string;
  fa?: string;
  fb?: string;
  erases?: boolean;
}

const MODES: Record<string, Mode> = {
  normal: {},
  multiply: { blend: 'cb * cs' },
  screen: { blend: 'cb + cs - cb * cs' },
  darken: { blend: 'min(cb, cs)' },
  lighten: { blend: 'max(cb, cs)' },
  overlay: { blend: 'blendHardLight(cs, cb)' },
  'hard-light': { blend: 'blendHardLight(cb, cs)' },
  'soft-light': { blend: 'blendSoftLight(cb, cs)' },
  'color-dodge': { blend: 'blendColorDodge(cb, cs)' },
  'color-burn': { blend: 'blendColorBurn(cb, cs)' },
  difference: { blend: 'abs(cb - cs)' },
  exclusion: { blend: 'cb + cs - 2.0 * cb * cs' },
  hue: { blend: 'setLum(setSat(cs, sat(cb)), lum(cb))' },
  saturation: { blend: 'setLum(setSat(cb, sat(cs)), lum(cb))' },
  color: { blend: 'setLum(cs, lum(cb))' },
  luminosity: { blend: 'setLum(cb, lum(cs))' },
  // the Porter Duff operators, which canvas takes in the same property
  'destination-over': { fa: '1.0 - ba', fb: '1.0' },
  'source-in': { fa: 'ba', fb: '0.0', erases: true },
  'destination-in': { fa: '0.0', fb: 'sa', erases: true },
  'source-out': { fa: '1.0 - ba', fb: '0.0', erases: true },
  'destination-out': { fa: '0.0', fb: '1.0 - sa' },
  'source-atop': { fa: 'ba', fb: '1.0 - sa' },
  'destination-atop': { fa: '1.0 - ba', fb: 'sa', erases: true },
  xor: { fa: '1.0 - ba', fb: '1.0 - sa' },
  lighter: { fa: '1.0', fb: '1.0' },
  copy: { fa: '1.0', fb: '0.0', erases: true },
};

/** Every mode this can evaluate, which is every one canvas has. */
export const BLEND_MODES: readonly string[] = Object.keys(MODES);

/** Modes that touch the frame where the source does not reach. */
export const ERASING_MODES: readonly string[] = Object.entries(MODES)
  .filter(([, mode]) => mode.erases)
  .map(([name]) => name);

const BLEND_HELPERS = `fn blendHardLight(cb: vec3<f32>, cs: vec3<f32>) -> vec3<f32> {
    return select(1.0 - 2.0 * (1.0 - cb) * (1.0 - cs), 2.0 * cb * cs, cs <= vec3<f32>(0.5));
}

fn blendSoftLight(cb: vec3<f32>, cs: vec3<f32>) -> vec3<f32> {
    let d = select(sqrt(cb), ((16.0 * cb - 12.0) * cb + 4.0) * cb, cb <= vec3<f32>(0.25));
    let lo = cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
    let hi = cb + (2.0 * cs - 1.0) * (d - cb);
    return select(hi, lo, cs <= vec3<f32>(0.5));
}

fn blendColorDodge(cb: vec3<f32>, cs: vec3<f32>) -> vec3<f32> {
    let lit = select(min(vec3<f32>(1.0), cb / max(1.0 - cs, vec3<f32>(1e-6))), vec3<f32>(1.0), cs >= vec3<f32>(1.0));
    return select(lit, vec3<f32>(0.0), cb <= vec3<f32>(0.0));
}

fn blendColorBurn(cb: vec3<f32>, cs: vec3<f32>) -> vec3<f32> {
    let burnt = select(
        1.0 - min(vec3<f32>(1.0), (1.0 - cb) / max(cs, vec3<f32>(1e-6))),
        vec3<f32>(0.0),
        cs <= vec3<f32>(0.0),
    );
    return select(burnt, vec3<f32>(1.0), cb >= vec3<f32>(1.0));
}

fn lum(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.3, 0.59, 0.11));
}

fn clipColor(c: vec3<f32>) -> vec3<f32> {
    let l = lum(c);
    let lo = min(c.r, min(c.g, c.b));
    let hi = max(c.r, max(c.g, c.b));
    var out = c;
    if lo < 0.0 {
        out = l + (out - l) * l / max(l - lo, 1e-6);
    }
    if hi > 1.0 {
        out = l + (out - l) * (1.0 - l) / max(hi - l, 1e-6);
    }
    return out;
}

fn setLum(c: vec3<f32>, l: f32) -> vec3<f32> {
    return clipColor(c + (l - lum(c)));
}

fn sat(c: vec3<f32>) -> f32 {
    return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
}

fn setSat(c: vec3<f32>, s: f32) -> vec3<f32> {
    let lo = min(c.r, min(c.g, c.b));
    let range = max(c.r, max(c.g, c.b)) - lo;
    return select(vec3<f32>(0.0), (c - lo) * s / range, vec3<bool>(range > 0.0));
}`;

/**
 * The source over the destination with a blend applied, computed rather than
 * left to fixed function factors.
 *
 * Canvas composites a blended mark as `as*(1-ab)*Cs + as*ab*B(Cb,Cs) +
 * (1-as)*ab*Cb`. One set of factors reaches the destination or weights the
 * source by its own alpha, not both, so multiply and screen come out exact only
 * because their algebra happens to fold, and min and max have no term to
 * interpolate with at all: darken and lighten are wrong wherever the source is
 * not fully opaque, which includes every antialiased edge.
 *
 * The mark is drawn into a layer of its own instead, the frame is copied out
 * beneath it, and this evaluates the formula on the two and replaces the pixel.
 */
export const blendCompositeShader = (blend: string): string => {
  const mode = MODES[blend] ?? MODES.normal;
  return `
${BLEND_HELPERS}

@group(0) @binding(0) var layerTexture: texture_2d<f32>;
@group(0) @binding(1) var backdropTexture: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
}

// One triangle over the whole frame, which needs no uniforms of its own. What
// the layer does not cover is discarded, so the reach is the mark's either way.
@vertex
fn main_vertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var corners = array(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
    var out: VertexOutput;
    out.pos = vec4<f32>(corners[vertexIndex], 0.0, 1.0);
    return out;
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let at = vec2<i32>(in.pos.xy);
    // both premultiplied, which is what the frame holds
    let src = textureLoad(layerTexture, at, 0);
    let dst = textureLoad(backdropTexture, at, 0);
    let sa = src.a;
${
  mode.erases
    ? ''
    : `    if sa <= 0.0 {
        discard;
    }`
}
    let ba = dst.a;
    let cs = src.rgb / max(sa, 1e-6);
    let cb = dst.rgb / max(ba, 1e-6);
    // the source with the blend already folded into the part the backdrop
    // covers, which is what the operator weights go on
    let csp = (1.0 - ba) * cs + ba * (${mode.blend ?? 'cs'});
    let fa = ${mode.fa ?? '1.0'};
    let fb = ${mode.fb ?? '1.0 - sa'};
    return vec4<f32>(sa * fa * csp + fb * dst.rgb, sa * fa + ba * fb);
}
`;
};
