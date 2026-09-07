import { BOX_COVERAGE, FILL_STROKE_SHARE, TO_NDC, fragmentTail, uniformBlock } from './common.js';
import { GRADIENT_BLOCK } from './gradient.js';

/**
 * Rects and group backgrounds: one instanced quad each, with coverage computed
 * analytically so two abutting rects leave the faint seam canvas leaves rather
 * than a whole missing MSAA sample. Also carries the gradient-filled variant,
 * which shares the geometry and differs only in where the fill comes from.
 */
export const rectShader = (blend: string): string => `
${uniformBlock('dpi')}

${GRADIENT_BLOCK}

${TO_NDC}

${FILL_STROKE_SHARE}

${BOX_COVERAGE}

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
fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput {
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

    var output: VertexOutput;
    output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0);
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
// nominal edge like canvas strokes do. aa is the antialiasing width.
fn roundedRectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> {
    let p = (in.uv - vec2<f32>(0.5, 0.5)) * (in.scale + vec2<f32>(in.strokewidth, in.strokewidth));
    let scale = max(uniforms.dpi, 0.001);
    let d = sdRoundedRect(p, in.scale * 0.5, in.corner_radii) * scale;
    let half_sw = in.strokewidth * 0.5 * scale;
    let aa = 0.75;

    let strokeMix = smoothstep(-half_sw - aa, -half_sw + aa, d);
    let coverage = 1.0 - smoothstep(half_sw - aa, half_sw + aa, d);
    var col = mix(fill, in.stroke, strokeMix);
    return vec4<f32>(col.rgb, col.a * coverage);
}

fn straightRectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> {
    let p = in.pos.xy;
    let sw = vec2<f32>(in.strokewidth, in.strokewidth) * max(uniforms.dpi, 0.001);
    let outer = boxCoverage(p, in.lo_dev, in.hi_dev);
    let inner = boxCoverage(p, in.lo_dev + sw, in.hi_dev - sw);
    return fillStrokeShare(fill, in.stroke, inner, outer);
}

fn maxRadius(radii: vec4<f32>) -> f32 {
    return max(max(radii.x, radii.y), max(radii.z, radii.w));
}

fn rectColor(in: VertexOutput, fill: vec4<f32>) -> vec4<f32> {
    if maxRadius(in.corner_radii) <= 0.0 {
        return straightRectColor(in, fill);
    }
    return roundedRectColor(in, fill);
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    return rectColor(in, in.fill);
}

fn gradientColor(in: VertexOutput) -> vec4<f32> {
    // un-flip: gradient coordinates run top-down like canvas coordinates
    let p = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
    let t = gradientT(p, in.scale);
    let sample = textureSample(stopRamp, stopSampler, vec2<f32>(t, 0.5));
    return rectColor(in, vec4<f32>(sample.rgb, sample.a * in.fill.a));
}

${fragmentTail(blend, { main_fragment: 'fragmentColor', main_fragment_gradient: 'gradientColor' })}
`;
