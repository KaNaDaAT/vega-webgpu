import { SEGMENT_NORMAL, TO_NDC, fragmentTail, uniformBlock } from './common.js';
import { GRADIENT_BLOCK } from './gradient.js';

/**
 * One quad per line segment instance, with the coverage of the segment computed
 * analytically. Dashes, dashed rect borders, diagonal rules, shape outlines and
 * line segments all come through here.
 *
 * Each end carries how it finishes: a flat cut, a round cap, or a join, as the
 * outward bisector of the corner and how far along it the outer corner reaches.
 * Both segments at a vertex get the same bisector and keep opposite sides of
 * it, so their union is the joined outline with no overlap between them.
 */
export const slineShader = (blend: string): string => `
${uniformBlock('dpi')}

${GRADIENT_BLOCK}

${TO_NDC}

${SEGMENT_NORMAL}

struct VertexInput {
    @location(0) start: vec2<f32>,
    @location(1) end: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) stroke_width: f32,
    @location(4) join_start: vec4<f32>,
    @location(5) join_end: vec4<f32>,
    @location(6) reach: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) fill: vec4<f32>,
    // segment ends and half width in device pixels, for analytic coverage
    @location(1) a_dev: vec2<f32>,
    @location(2) b_dev: vec2<f32>,
    @location(3) half_dev: f32,
    // per instance, and the kind inside is matched exactly, which barycentric
    // rounding of a smooth varying does not survive
    @location(4) @interpolate(flat) join_start: vec4<f32>,
    @location(5) @interpolate(flat) join_end: vec4<f32>,
    // where the fragment sits in world space, for a stroke drawn from a ramp
    @location(6) world: vec2<f32>,
    // how far the neighbour at each end runs before it stops
    @location(7) @interpolate(flat) reach: vec2<f32>,
}

// What a segment does at one of its ends. util/join.ts writes these.
const END_BUTT: f32 = 0.0;
const END_ROUND_CAP: f32 = 1.0;
const END_ROUND_JOIN: f32 = 2.0;
const END_MITER: f32 = 3.0;
const END_BEVEL: f32 = 4.0;
const END_CAP_MEET: f32 = 5.0;

/**
 * How far past the end point the quad has to reach: nothing for a flat end,
 * half the width for anything that rounds off there, and the corner's own reach
 * along the bisector for the two that run on.
 */
fn endReach(join: vec4<f32>, half_w: f32, outward: vec2<f32>) -> f32 {
    let kind = join.w;
    if kind == END_BUTT {
        return 0.0;
    }
    if kind == END_ROUND_CAP || kind == END_ROUND_JOIN || kind == END_CAP_MEET {
        return half_w;
    }
    return max(join.z * dot(join.xy, outward), 0.0);
}

@vertex
fn main_vertex(in: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    let d = max(uniforms.dpi, 0.001);
    let delta = in.end - in.start;
    let direction = safeDirection(delta);
    let normal = normalAt(delta);

    // Grow the quad by one device pixel so the falloff is not clipped, which
    // leaves every pixel the segment touches fully rasterized.
    let pad = 1.0 / d;
    let half = in.stroke_width * 0.5;
    let side = normal * (half + pad);
    let behind = direction * (pad + endReach(in.join_start, half, -direction));
    let ahead = direction * (pad + endReach(in.join_end, half, direction));

    let p1 = in.start - side - behind;
    let p2 = in.start + side - behind;
    let p3 = in.end - side + ahead;
    let p4 = in.end + side + ahead;

    var vertices = array(p1, p2, p3, p4, p2, p3);
    let ndc = toNdc(vertices[vertexIndex] - uniforms.offset, uniforms.resolution);

    var out: VertexOutput;
    out.pos = vec4<f32>(ndc, 0.0, 1.0);
    out.world = vertices[vertexIndex];
    out.fill = in.color;
    out.a_dev = (in.start - uniforms.offset) * d;
    out.b_dev = (in.end - uniforms.offset) * d;
    out.half_dev = half * d;
    // the cut is a length, so it crosses into device pixels with the rest
    out.join_start = vec4<f32>(in.join_start.xy, in.join_start.z * d, in.join_start.w);
    out.join_end = vec4<f32>(in.join_end.xy, in.join_end.z * d, in.join_end.w);
    out.reach = in.reach * d;
    return out;
}

/**
 * What one end leaves of the pixel.
 *
 * A flat cut and the outer limit of a corner both take a half pixel falloff,
 * since those are real edges of the stroke. The bisector a join is cut against
 * is not: it runs through the middle of the joined outline and the segment on
 * the other side of it draws the rest, so a falloff there would show as a pale
 * seam where the two meet. It is a hard cut, with the tie given to one side.
 *
 * The reach is how far the neighbour runs from the vertex before it stops,
 * which the cut only holds up to. A dash ending within a half width of a
 * corner leaves a stub shorter than the bisector asks of it, and what it
 * cannot cover stays here rather than being given away to nothing.
 */
fn endFactor(v: vec2<f32>, outward: vec2<f32>, join: vec4<f32>, half_w: f32, reach: f32) -> f32 {
    let kind = join.w;
    if kind == END_ROUND_CAP {
        return 1.0;
    }
    if kind == END_BUTT {
        return clamp(0.5 - dot(v, outward), 0.0, 1.0);
    }
    let m = join.xy;
    if kind == END_CAP_MEET {
        // Cut back to the plane halfway to the end it faces, which is every
        // pair of caps closer together than the stroke is wide, around a corner
        // as readily as along a straight run. With equal radii each arc is the
        // outer one on its own side, so the two cuts trace the union canvas
        // fills. Past the end point the plane is the whole answer, since out
        // there both shapes are only their caps. Inside the band the test is
        // instead whether the cap it faces covers the pixel outright: around a
        // sharp corner that cap reaches across the turn into this run's body.
        if dot(v, m) <= join.z {
            return 1.0;
        }
        if dot(v, outward) > 0.0 {
            return 0.0;
        }
        return select(1.0, 0.0, length(v - m * (join.z * 2.0)) < half_w - 0.5);
    }
    // a bevel stops at its own limit along the bisector
    let outer = select(1.0, clamp(0.5 + join.z - dot(v, m), 0.0, 1.0), kind == END_BEVEL);
    if dot(v, outward) <= 0.0 {
        // The neighbour's own axis, since it and this one keep equal angles to
        // the bisector. Past where that neighbour stops, nothing else draws
        // this, so the cut gives way.
        let other = outward - 2.0 * dot(outward, m) * m;
        if dot(v, other) > reach {
            return outer;
        }
    }
    var n = vec2<f32>(-m.y, m.x);
    // The two segments at a vertex always disagree on this sign, so one of them
    // takes the tie rather than both, which is what keeps a pixel whose centre
    // lands on the bisector, as every axis aligned corner has, from being
    // painted twice and coming out darker than canvas draws it. The two read
    // the same distance with opposite signs down to the bit, so which side of
    // zero it falls decides it: a window either way leaves a gap or an overlap
    // as wide as the window, which a corner runs a diagonal of pixels through.
    let flipped = dot(n, outward) < 0.0;
    if flipped {
        n = -n;
    }
    let side = dot(v, n);
    if select(side > 0.0, side >= 0.0, flipped) {
        return 0.0;
    }
    return outer;
}

/**
 * Whether the axis runs past the end point rather than rounding off there. The
 * three that reach into the corner do; a cap, a round join and a cut cap all
 * stop at the end point, and stopping is what makes the disc.
 */
fn runsOn(join: vec4<f32>) -> bool {
    return join.w == END_MITER || join.w == END_BEVEL;
}

/**
 * Distance to the segment, cut at each end by how that end finishes. MSAA can
 * only express quarter steps, which reads as a stepped diagonal where canvas
 * draws a smooth one.
 */
fn fragmentColor(in: VertexOutput) -> vec4<f32> {
    let ab = in.b_dev - in.a_dev;
    let len = length(ab);
    let e = safeDirection(ab);
    let v = in.pos.xy - in.a_dev;
    let along = dot(v, e);
    // A join reaches past its end point, so the axis runs on rather than
    // rounding off there. A cap keeps the disc, which is what rounds it.
    let lo = select(0.0, -1e6, runsOn(in.join_start));
    let hi = select(len, 1e6, runsOn(in.join_end));
    // the difference of the two edges, so a stroke thinner than a pixel reports
    // its real width rather than the 0.6 the near edge alone would give
    let dist = length(v - e * clamp(along, lo, hi));
    let cover = clamp(in.half_dev - dist + 0.5, 0.0, 1.0) - clamp(-in.half_dev - dist + 0.5, 0.0, 1.0);
    let behind = endFactor(v, -e, in.join_start, in.half_dev, in.reach.x);
    let ahead = endFactor(in.pos.xy - in.b_dev, e, in.join_end, in.half_dev, in.reach.y);
    return vec4<f32>(in.fill.rgb, in.fill.a * cover * behind * ahead);
}

/**
 * The same coverage, with the colour taken from the ramp rather than from the
 * instance. A stroke that is both a gradient and dashed has to come through
 * here: the extruded ribbon is the only other thing that can sample a ramp, and
 * it cannot carry a dash, so before this the dash was silently dropped.
 */
fn gradientColor(in: VertexOutput) -> vec4<f32> {
    let solid = fragmentColor(in);
    let normalized = (in.world - gradient.bounds.xy) / max(gradient.bounds.zw, vec2<f32>(1e-6, 1e-6));
    let t = gradientT(normalized, gradient.bounds.zw);
    let ramp = textureSample(stopRamp, stopSampler, vec2<f32>(t, 0.5));
    return vec4<f32>(ramp.rgb, ramp.a * solid.a);
}

${fragmentTail(blend, { main_fragment: 'fragmentColor', main_fragment_gradient: 'gradientColor' })}

/**
 * Coverage alone, for a stroke composited as one shape. The mask pass keeps the
 * largest value each pixel receives, so two bands meeting on one cover it once
 * instead of compositing over each other.
 */
@fragment
fn main_fragment_mask(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(fragmentColor(in).a, 0.0, 0.0, 1.0);
}
`;
