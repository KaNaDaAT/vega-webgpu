import { FILL_STROKE_SHARE, TO_NDC, fragmentTail, uniformBlock } from './common.js';

/** Analytic circles: one instanced quad per symbol, edge and stroke by distance. */
export const symbolShader = (blend: string): string => `
${uniformBlock('dpi')}

${TO_NDC}

${FILL_STROKE_SHARE}

struct VertexInput {
  @location(0) position: vec2<f32>,
}

struct InstanceInput {
  @location(1) center: vec2<f32>,
  @location(2) radius: f32,
  @location(3) fill_color: vec4<f32>,
  @location(4) stroke_color: vec4<f32>,
  @location(5) stroke_width: f32,
}

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) fill: vec4<f32>,
  @location(2) stroke_color: vec4<f32>,
  @location(3) radius: f32,
  @location(4) stroke_width: f32,
  @location(5) geom_radius: f32,
}

// Extra geometry padding so the analytic circle edge fades out inside the
// tessellated geometry.
const pad = 1.0;

@vertex
fn main_vertex(model: VertexInput, instance: InstanceInput) -> VertexOutput {
    // The stroke straddles the fill radius, so the geometry must reach the
    // outer stroke edge (radius + stroke_width/2) plus AA padding.
    let geom_radius = instance.radius + instance.stroke_width * 0.5 + pad;
    let p = model.position * geom_radius + instance.center - uniforms.offset;

    var output: VertexOutput;
    output.pos = vec4<f32>(toNdc(p, uniforms.resolution), 0.0, 1.0);
    output.uv = model.position * 0.5 + vec2<f32>(0.5, 0.5);
    output.fill = instance.fill_color;
    output.stroke_color = instance.stroke_color;
    output.radius = instance.radius;
    output.stroke_width = instance.stroke_width;
    output.geom_radius = geom_radius;
    return output;
}

/**
 * Mixing fill towards the stroke colour instead reads a strokeless symbol's
 * transparent black as a colour, which darkens every edge pixel and squares its
 * alpha.
 */
fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    // distance from the symbol center, in logical pixels
    let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0 * in.geom_radius;
    let scale = max(uniforms.dpi, 0.001);
    let half_sw = in.stroke_width * 0.5;
    let outer = clamp(0.5 - (d - in.radius - half_sw) * scale, 0.0, 1.0);
    let inner = clamp(0.5 - (d - in.radius + half_sw) * scale, 0.0, 1.0);
    return fillStrokeShare(in.fill, in.stroke_color, inner, outer);
}

${fragmentTail(blend)}
`;
