import { BOX_COVERAGE, TO_NDC, fragmentTail, uniformBlock } from './common.js';

/**
 * Axis-aligned rules, drawn as one instanced quad with analytic coverage. MSAA
 * quantizes a 1px rule to whole samples, so it reads as one hard column instead
 * of the soft two canvas draws.
 */
export const ruleShader = (blend: string): string => `
${uniformBlock('dpi')}

${TO_NDC}

${BOX_COVERAGE}

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) center: vec2<f32>,
    @location(2) scale: vec2<f32>,
    @location(3) stroke_color: vec4<f32>,
    @location(4) axis_offset: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(1) stroke: vec4<f32>,
    // true rule edges in device pixels, for analytic coverage
    @location(2) lo_dev: vec2<f32>,
    @location(3) hi_dev: vec2<f32>,
}

@vertex
fn main_vertex(in: VertexInput) -> VertexOutput {
    let d = max(uniforms.dpi, 0.001);
    let lo = in.center - uniforms.offset - in.axis_offset;
    let hi = lo + in.scale;

    // Grow the quad by one device pixel so the falloff below is not clipped.
    // Every pixel the rule touches is then fully rasterized, so MSAA adds no
    // edge coverage of its own and the fragment alpha does all of it.
    let pad = vec2<f32>(1.0, 1.0) / d;
    let p = mix(lo - pad, hi + pad, in.position);

    var output: VertexOutput;
    output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0);
    output.stroke = in.stroke_color;
    output.lo_dev = lo * d;
    output.hi_dev = hi * d;
    return output;
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    return vec4<f32>(in.stroke.rgb, in.stroke.a * boxCoverage(in.pos.xy, in.lo_dev, in.hi_dev));
}

${fragmentTail(blend)}
`;
