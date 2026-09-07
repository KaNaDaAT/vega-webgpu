import { TO_NDC, fragmentTail } from './common.js';

/**
 * Batched line segments, each instance carrying its own resolution and offset
 * so a whole mark draws without rebinding. The edge across the stroke fades in
 * the fragment shader rather than relying on MSAA.
 */
export const lineShader = (blend: string): string => `
${TO_NDC}

struct VertexInput {
    @location(0) start: vec2<f32>,
    @location(1) end: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) stroke_width: f32,
    @location(4) resolution: vec2<f32>,
    @location(5) offset: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) fill: vec4<f32>,
    @location(2) smooth_width: f32,
}

const smooth_step = 1.5;

@vertex
fn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    // normalize() on a zero-length segment returns NaN
    let delta = in.end - in.start;
    let seg_len = length(delta);
    let direction = select(vec2<f32>(1.0, 0.0), delta / seg_len, seg_len > 1e-6);
    let normal = vec2<f32>(-direction.y, direction.x);

    let adjusted_width = in.stroke_width + smooth_step;
    let offset = normal * (adjusted_width * 0.5);

    let p1 = in.start - offset;
    let p2 = in.start + offset;
    let p3 = in.end - offset;
    let p4 = in.end + offset;

    var vertices = array(p1, p2, p3, p2, p4, p3);
    var uvs = array(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 1.0)
    );
    let ndc = toNdc(vertices[vertexIndex] - in.offset, in.resolution);

    var out: VertexOutput;
    out.pos = vec4<f32>(ndc, 0.0, 1.0);
    out.uv = uvs[vertexIndex];
    out.fill = in.color;
    out.smooth_width = adjusted_width / in.stroke_width - 1.0;
    return out;
}

fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    let sx = abs(in.uv.x - 0.5) * 2.0;
    let aax = 1.0 - smoothstep(1.0 - in.smooth_width, 1.0, sx);
    return vec4<f32>(in.fill.rgb, in.fill.a * aax);
}

${fragmentTail(blend)}
`;
