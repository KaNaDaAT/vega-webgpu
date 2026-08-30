
struct VertexInput {
    @location(0) start: vec2<f32>,
    @location(1) end: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) stroke_width: f32,
    @location(4) resolution: vec2<f32>,
    @location(5) offset: vec2<f32>,
};


struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0)  uv: vec2<f32>,
    @location(1) fill: vec4<f32>,
    @location(2) smooth_width: f32,
};

const smooth_step = 1.5;

@vertex
fn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    let start = in.start;
    let end = in.end;
    let color = in.color;
    let stroke_width = in.stroke_width;

    // normalize() on a zero-length segment returns NaN
    let delta = end - start;
    let seg_len = length(delta);
    let direction = select(vec2<f32>(1.0, 0.0), delta / seg_len, seg_len > 1e-6);
    // Calculate the normal vector
    let normal = vec2<f32>(-direction.y, direction.x);

    // Calculate the offset for width
    let adjusted_width = stroke_width + smooth_step;
    let offset = normal * ((adjusted_width) * 0.5);

    // Calculate the four points of the line
    var p1 = start - offset;
    var p2 = start + offset;
    var p3 = end - offset;
    var p4 = end + offset;

    var vertices = array(p1, p2, p3, p2, p4, p3);
    var uvs = array(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, 1.0)
    );
    var pos = vertices[vertexIndex];
    pos = (pos - in.offset) / in.resolution;
    pos.y = 1.0 - pos.y;
    pos = pos * 2.0 - 1.0;

    var out: VertexOutput;
    out.pos = vec4<f32>(pos, 0.0, 1.0);
    out.uv = uvs[vertexIndex];
    out.fill = color;
    out.smooth_width = adjusted_width / stroke_width - 1.0;
    return out;
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let sx = abs(in.uv.x - 0.5) * 2.0;
    let sy = abs(in.uv.y - 0.5) * 2.0;
    let aax: f32 = 1.0 - smoothstep(1.0 - in.smooth_width, 1.0, sx);
    // let aay: f32 = 1.0 - smoothstep(1.0 - in.smooth_length, 1.0, sy);
    return vec4<f32>(in.fill.rgb, in.fill.a * aax);
}