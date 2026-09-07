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

/** `blendAdjust`, which every generated fragment entry point calls. */
export function blendPrelude(blend: string): string {
  return `fn blendAdjust(c: vec4<f32>) -> vec4<f32> {
    return ${SOURCE_COLOR[blend] ?? SOURCE_COLOR.normal};
}`;
}

/**
 * The fragment entry point every shader shares. `colorFn` returns the mark's
 * colour with straight alpha, and this drops the fragment when it covers
 * nothing and weights the rest for the blend mode.
 *
 * The discard is not an optimization. Marks grow their geometry past the shape
 * so an analytic edge is not clipped, and those empty fragments still change
 * the destination under a multiply or a min.
 */
export function fragmentEntry(entryPoint: string, colorFn: string): string {
  return `@fragment
fn ${entryPoint}(in: VertexOutput) -> @location(0) vec4<f32> {
    let c = ${colorFn}(in);
    if c.a <= 0.0 {
        discard;
    }
    return blendAdjust(c);
}`;
}

/** Builds one shader source. `arg` names a shape, curve or other sub-variant. */
export type ShaderBuilder = (blend: string, arg?: string) => string;
