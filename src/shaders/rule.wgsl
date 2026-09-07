struct Uniforms {
    resolution: vec2<f32>,
    offset: vec2<f32>,
    dpi: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

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
    var output : VertexOutput;
    let d = max(uniforms.dpi, 0.001);
    let lo = in.center - uniforms.offset - in.axis_offset;
    let hi = lo + in.scale;

    // Grow the quad by one device pixel so the falloff below is not clipped.
    // Every pixel the rule touches is then fully rasterized, so MSAA adds no
    // edge coverage of its own and the fragment alpha does all of it.
    let pad = vec2<f32>(1.0, 1.0) / d;
    var pos = mix(lo - pad, hi + pad, in.position);

    pos = pos / uniforms.resolution;
    pos.y = 1.0 - pos.y;
    pos = pos * 2.0 - 1.0;
    output.pos = vec4<f32>(pos, 0.0, 1.0);
    output.stroke = in.stroke_color;
    output.lo_dev = lo * d;
    output.hi_dev = hi * d;
    return output;
}

/**
 * Fraction of the pixel the rule covers, computed the way canvas does it. MSAA
 * quantizes a 1px rule to whole samples, so it reads as one hard column instead
 * of the soft two canvas draws.
 */
@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let p = in.pos.xy;
    let cx = clamp(min(p.x - in.lo_dev.x, in.hi_dev.x - p.x) + 0.5, 0.0, 1.0);
    let cy = clamp(min(p.y - in.lo_dev.y, in.hi_dev.y - p.y) + 0.5, 0.0, 1.0);
    let a = in.stroke.a * cx * cy;
    // A fragment with no coverage must not reach the blend state: under a
    // multiply or min it would still change the destination.
    if a <= 0.0 {
        discard;
    }
    return vec4<f32>(in.stroke.rgb, a);
}
