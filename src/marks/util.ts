import { Bounds, boundContext, sceneVisit, pathRectangle } from 'vega-scenegraph';
import geometryForPath, { DASH_FLATNESS } from '../path/geometryForPath.js';
import geometryForItem, { type ItemTransform } from '../path/geometryForItem.js';
import { BufferManager, uploadBuffer } from '../util/bufferManager.js';
import type { Point } from '../types/geometry.js';
import { dashPolyline, prepareDash } from '../util/dash.js';
import {
  KIND_CAP_MEET,
  KIND_ROUND_CAP,
  capEnd,
  isLoop,
  joinStyleOf,
  writeEnd,
  writeJoin,
  type JoinEnd,
} from '../util/join.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { REPLACE, blendState, buildBlend } from '../util/blend.js';
import { shaderModule, type ShaderKey } from '../shaders/index.js';
import { createRenderPipeline, preferredColorFormat } from '../util/webgpu.js';
import type { ClipRect, GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { DrawCounts, QueueElement } from '../util/renderQueue.js';
import type { SceneGroupExt, SceneRectExt, SceneItem } from '../types/scene.js';
import { Color, isGradient, type RGBA } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import type { SceneColor, SceneGradient } from '../types/scene.js';
import type WebGPURenderer from '../WebGPURenderer.js';

/** A mark renderer module, as registered in marks/index.ts. */
export interface MarkModule {
  draw: (
    this: WebGPURenderer,
    device: GPUDevice,
    ctx: GPUVegaCanvasContext,
    scene: GPUVegaScene,
    vb: Bounds,
    markTypes?: string[],
  ) => void;
}

/**
 * Returns the GPU resources for a mark type, creating them on first use
 * or after a device change. Resources live on the canvas context, so each
 * renderer instance keeps its own set.
 */
export function getMarkResources<T extends { device: GPUDevice }>(
  ctx: GPUVegaCanvasContext,
  markType: string,
  device: GPUDevice,
  vb: Bounds | undefined,
  create: () => T,
): T {
  const cached = ctx._markCache[markType] as T | undefined;
  const res = cached && cached.device === device ? cached : ((ctx._markCache[markType] = create()) as T);
  // Resources outlive the frame, so a cached BufferManager still holds the
  // previous frame's resolution and group offset. Refreshing here means a mark
  // cannot forget to, which would draw the whole mark at a stale offset.
  if (vb) {
    const buffers = (res as { bufferManager?: BufferManager }).bufferManager;
    buffers?.setResolution(ctx._uniforms.resolution);
    buffers?.setOffset([vb.x1, vb.y1]);
    buffers?.setDpi(ctx._uniforms.dpi);
    buffers?.setClipRound(ctx._clipRound);
    buffers?.setClipMask(ctx._clipMask !== undefined);
  }
  return res;
}

/**
 * Floats per triangulated vertex: position and colour. Every buffer
 * `vertexData` writes and every draw that consumes one is this wide, which is
 * also the layout `fillResources` builds its pipelines with.
 */
const GEOMETRY_STRIDE = 7;

/** Triangulated geometry in one colour, as [x, y, z, r, g, b, a] vertices. */
export function vertexData(triangles: Float32Array, count: number, color: RGBA): Float32Array {
  const data = new Float32Array(count * GEOMETRY_STRIDE);
  for (let i = 0; i < count; i++) {
    const o = i * GEOMETRY_STRIDE;
    data[o] = triangles[i * 3];
    data[o + 1] = triangles[i * 3 + 1];
    data[o + 2] = triangles[i * 3 + 2] * -1;
    data[o + 3] = color[0];
    data[o + 4] = color[1];
    data[o + 5] = color[2];
    data[o + 6] = color[3];
  }
  return data;
}

/**
 * A box in the current group's coordinates, as a scissor rect in device
 * pixels. The group translation is already in `_tx`.
 */
export function deviceClip(ctx: GPUVegaCanvasContext, x: number, y: number, w: number, h: number): ClipRect {
  const dpi = ctx._uniforms.dpi;
  return [(ctx._origin[0] + ctx._tx + x) * dpi, (ctx._origin[1] + ctx._ty + y) * dpi, w * dpi, h * dpi];
}

/**
 * The clip path's coverage for the mark being drawn, or the 1x1 placeholder
 * where there is no path clip.
 *
 * Every mark pipeline reads this binding, because every fragment entry calls
 * `clipCoverage`, so one has to be bound whether or not a clip path is in
 * force. The uniform flag beside it is what decides whether it is read.
 */
export function clipMaskView(ctx: GPUVegaCanvasContext, device: GPUDevice): GPUTextureView {
  return ctx._clipMask ?? ctx._renderer.clipMaskPlaceholderView(device);
}

/** A mark's group 0 bind group, with the clip mask in force. */
export function uniformBindGroup(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  label: string,
  pipeline: GPURenderPipeline,
  uniforms: GPUBuffer,
): GPUBindGroup {
  return createUniformBindGroup(label, device, pipeline, uniforms, clipMaskView(ctx, device));
}

/**
 * Two scissor rects narrowed to what both cover, which is what canvas's
 * `context.clip()` does to whatever is already clipped. An empty result is
 * left with a zero extent and the render queue drops the draw.
 */
export function intersectClip(outer: ClipRect | undefined, inner: ClipRect): ClipRect {
  if (!outer) {
    return inner;
  }
  const x = Math.max(outer[0], inner[0]);
  const y = Math.max(outer[1], inner[1]);
  const x2 = Math.min(outer[0] + outer[2], inner[0] + inner[2]);
  const y2 = Math.min(outer[1] + outer[3], inner[1] + inner[3]);
  return [x, y, Math.max(x2 - x, 0), Math.max(y2 - y, 0)];
}

/** Reused by the clip-path measurement below, which runs per mark per frame. */
const clipPathBounds = new Bounds();

/**
 * Scissor rect for a mark, in physical pixels.
 *
 * A mark with `clip: true` is clipped to its enclosing group, and one whose
 * clip is a path generator to that path's box. Either way the result is
 * narrowed by whatever the mark already sits inside.
 *
 * A path is only ever its box here. canvas clips to the path itself, so a
 * clip that is not a rectangle leaves the corners of its box drawn. See
 * test/render/README.md.
 */
export function markClip(ctx: GPUVegaCanvasContext, scene: GPUVegaScene): ClipRect | undefined {
  const clip = scene.clip;
  if (!clip) {
    return ctx._clip;
  }
  if (typeof clip === 'function') {
    const b = clipPathBounds.clear();
    clip(boundContext(b));
    return b.empty() ? ctx._clip : intersectClip(ctx._clip, deviceClip(ctx, b.x1, b.y1, b.width(), b.height()));
  }
  const group = scene.group;
  if (!group) {
    return ctx._clip;
  }
  return intersectClip(ctx._clip, deviceClip(ctx, 0, 0, group.width || 0, group.height || 0));
}

/**
 * An item's bounding box as [x, y, w, h] for a gradient to map its ramp over,
 * which is what vega's canvas renderer spans one across.
 *
 * Both the bounds and the geometry are in the enclosing group's coordinates,
 * and the group translation reaches the shader through the offset uniform, so
 * adding it here once more moved a ramp by the group offset.
 */
function gradientBounds(bounds: Bounds): [number, number, number, number] {
  return [bounds.x1, bounds.y1, Math.max(bounds.width(), 1e-6), Math.max(bounds.height(), 1e-6)];
}

/**
 * The box a rect or a group background spans its ramp over.
 *
 * vega's boundStroke grows an item's bounds by a whole stroke width on each
 * side, so a stroked rect fills its gradient over rather more than its own
 * box. A scenegraph that reached the renderer unbounded keeps the box.
 */
export function boxGradientBounds(item: SceneRectExt): [number, number, number, number] {
  if (item.bounds) {
    return gradientBounds(item.bounds);
  }
  const pad = item.stroke ? (item.strokeWidth ?? 1) : 0;
  const [x, y, w, h] = rectBox(item);
  return [x - pad, y - pad, Math.max(w + 2 * pad, 1e-6), Math.max(h + 2 * pad, 1e-6)];
}

/**
 * A rect's box with a negative extent flipped onto the other side of x or y,
 * which is how canvas's fillRect and strokeRect draw one.
 */
export function rectBox(item: SceneRectExt): [x: number, y: number, w: number, h: number] {
  let x = item.x || 0;
  let y = item.y || 0;
  let w = item.width || 0;
  let h = item.height || 0;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  return [x, y, w, h];
}

/** Fill color for vertex data: white carrier with opacity when a gradient is used. */
export function whiteCarrier(opacity = 1, fillOpacity = 1): RGBA {
  return [1, 1, 1, opacity * fillOpacity];
}

/** A gradient and the box it spans, in the [x, y, w, h] the gradient shaders read. */
export interface Ramp {
  gradient: SceneGradient;
  bounds: [x: number, y: number, w: number, h: number];
}

/** A fill or a stroke as it draws: the colour its vertices carry, and the ramp that replaces it. */
export interface Paint {
  colour: RGBA;
  ramp: Ramp | null;
}

/**
 * The ramp a paint draws from, or null for a flat colour. A gradient spans the
 * item's bounds, and with none it has nothing to span and draws flat.
 */
export function rampOf(value: SceneColor | null | undefined, bounds: Bounds | undefined): Ramp | null {
  return isGradient(value) && bounds ? { gradient: value, bounds: gradientBounds(bounds) } : null;
}

/** The same for a rect or a group, which span their own box when they have no bounds. */
export function boxRampOf(value: SceneColor | null | undefined, item: SceneRectExt): Ramp | null {
  return isGradient(value) ? { gradient: value, bounds: boxGradientBounds(item) } : null;
}

/** The colour a paint's vertices carry: white at its opacity under a ramp, its own colour otherwise. */
export function paintColour(
  value: SceneColor | null | undefined,
  opacity: number | undefined,
  paintOpacity: number | undefined,
  ramp: Ramp | null,
): RGBA {
  return ramp ? whiteCarrier(opacity, paintOpacity) : Color.from(value, opacity, paintOpacity);
}

/** A fill or a stroke as it draws, for an item that spans its bounds. */
export function paintOf(
  value: SceneColor | null | undefined,
  opacity: number | undefined,
  paintOpacity: number | undefined,
  bounds: Bounds | undefined,
): Paint {
  const ramp = rampOf(value, bounds);
  return { colour: paintColour(value, opacity, paintOpacity, ramp), ramp };
}

/** What a mark needs to paint triangulated geometry from a gradient ramp. */
/** Where a mark enqueues its fills or its outlines: a pipeline for each paint, the buffers and the clip. */
export interface DrawTarget {
  ctx: GPUVegaCanvasContext;
  device: GPUDevice;
  name: string;
  pipelineFor: (blend: string) => GPURenderPipeline;
  gradientPipelineFor: (blend: string) => GPURenderPipeline;
  bufferManager: BufferManager;
  uniformBuffer: GPUBuffer;
  clip: ClipRect | undefined;
}

export function targetOf(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  name: string,
  pipelines: {
    pipelineFor: (blend: string) => GPURenderPipeline;
    gradientPipelineFor: (blend: string) => GPURenderPipeline;
  },
  bufferManager: BufferManager,
  uniformBuffer: GPUBuffer,
  clip: ClipRect | undefined,
): DrawTarget {
  const { pipelineFor, gradientPipelineFor } = pipelines;
  return { ctx, device, name, pipelineFor, gradientPipelineFor, bufferManager, uniformBuffer, clip };
}

/**
 * One scratch array every instance builder writes into, so a mark does not
 * mint a new one each frame. createInstanceBuffer copies through writeBuffer
 * before it returns, so the next builder is free to overwrite it. At 300k
 * symbols this is 13.7 MB a frame that no longer has to be allocated and
 * collected. A batched draw holds its chunk instead, so it keeps its own.
 */
let scratch = new Float32Array(0);

export function instanceScratch(length: number): Float32Array {
  if (scratch.length < length) {
    scratch = new Float32Array(length);
  }
  return scratch.subarray(0, length);
}

/**
 * A mark's items in the order canvas paints them.
 *
 * vega draws the items carrying no zindex in list order and the raised ones
 * after, and its canvas renderer gets that by routing every mark through
 * sceneVisit. This one did it for group alone, so a raised item was picked as
 * if it were on top and drawn as if it were not.
 *
 * The list is returned untouched unless vega has actually z-ordered the mark,
 * which is the usual case and costs nothing. area, line and trail draw all
 * their items as one shape, so they keep the list whatever it says.
 */
export function markItems<T extends SceneItem>(scene: GPUVegaScene): T[] {
  const items = (scene.items ?? []) as T[];
  if (!scene.zdirty && scene.zitems === undefined) {
    return items;
  }
  const out: T[] = [];
  sceneVisit(scene, (item: SceneItem) => out.push(item as T));
  return out;
}

/** Queues one buffer of triangles, coloured by its vertices or from a ramp. */
export function enqueueFill(target: DrawTarget, data: Float32Array, ramp: Ramp | null, blend = 'normal'): void {
  enqueueDraw(target, ramp, blend, [data.length / GEOMETRY_STRIDE], [target.bufferManager.createGeometryBuffer(data)]);
}

/** Queues a draw through the target's pipelines, sampling the ramp when there is one. */
export function enqueueDraw(
  target: DrawTarget,
  ramp: Ramp | null,
  blend: string,
  drawCounts: DrawCounts,
  vertexBuffers: GPUBuffer[],
): void {
  const { ctx, device } = target;
  const pipeline = ramp ? target.gradientPipelineFor(blend) : target.pipelineFor(blend);
  const bindGroups = [uniformBindGroup(ctx, device, target.name, pipeline, target.uniformBuffer)];
  if (ramp) {
    bindGroups.push(createGradientBindGroup(getGradientResources(device, ctx), pipeline, ramp.gradient, ramp.bounds));
  }
  ctx._renderQueue.enqueue({ pipeline, drawCounts, vertexBuffers, bindGroups, clip: target.clip });
}

/**
 * Builds a mark pipeline. The colour format and sample count must match the
 * frame's attachments, and getting either wrong silently breaks MSAA, so they
 * are filled in here rather than repeated at every call site.
 */
export function markPipeline(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  label: string,
  shaderKey: ShaderKey,
  vertexManager: VertexBufferManager,
  fragmentEntryPoint?: string,
  blend = 'normal',
): GPURenderPipeline {
  // The backdrop decides how a blend is drawn and it can change between frames,
  // so it belongs in the key: a pipeline built for one is wrong for the other.
  const opaque = ctx._opaqueBackdrop;
  const key = `${shaderKey}|${fragmentEntryPoint ?? ''}|${ctx._sampleCount}|${blend}|${opaque}|${vertexManager.layoutKey}`;
  const cached = ctx._pipelineCache[key];
  if (cached) {
    return cached;
  }
  const built = buildBlend(blend, opaque);
  const pipeline = createRenderPipeline(
    label,
    device,
    shaderModule(ctx, device, shaderKey, built.blend),
    preferredColorFormat(),
    ctx._sampleCount,
    vertexManager.getBuffers(),
    blendState(built.blend),
    fragmentEntryPoint,
  );
  built.record(pipeline);
  ctx._pipelineCache[key] = pipeline;
  return pipeline;
}

/** The dash pattern of an item, or null when its outline draws solid. */
export function dashPatternOf(item: { strokeDash?: number[] | null }): number[] | null {
  const dash = item.strokeDash;
  return Array.isArray(dash) && dash.some(d => d > 0) ? dash : null;
}

/**
 * What a mark that triangulates its shape needs: a solid fill, the same taking
 * its colour from a ramp, and an outline drawn through the segment shader.
 *
 * arc, area, path, shape and trail all want exactly this. A mark adds its own
 * fields by spreading this into its record rather than inheriting from it,
 * since what they add has nothing in common.
 */
export interface FillResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  /** The fill, one pipeline per blend mode. */
  pipelineFor: (blend: string) => GPURenderPipeline;
  /** The same, taking the colour from a ramp. */
  gradientPipelineFor: (blend: string) => GPURenderPipeline;
  outline: OutlinePipelines;
}

export function fillResources(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  vb: Bounds,
  name: string,
  outlineName = `${name}Dash`,
): FillResources {
  const bufferManager = new BufferManager(device, name);
  const vertexManager = new VertexBufferManager(['float32x3', 'float32x4']); // position, colour
  return {
    device,
    bufferManager,
    vertexManager,
    pipelineFor: blendPipelines(ctx, device, name, 'SolidFill', vertexManager),
    gradientPipelineFor: blendPipelines(ctx, device, `${name}Gradient`, 'GradientFill', vertexManager),
    outline: outlinePipelines(ctx, device, outlineName),
  };
}

/**
 * The segment shader pipelines a mark strokes an outline with, and the layout
 * they share.
 *
 * Every mark that walks its own contours wants the same pair, and since
 * `markPipeline` caches on the layout rather than the label they are the same
 * pipelines whoever asks. Ten marks each built them by hand, which is where the
 * routes that quietly dropped their blend mode were hiding.
 */
export interface OutlinePipelines {
  /** Labels the pipelines and the bind groups made from them. */
  name: string;
  vertexManager: VertexBufferManager;
  /** Solid, one per blend mode. */
  pipelineFor: (blend: string) => GPURenderPipeline;
  /** The same, taking the colour from a ramp. */
  gradientPipelineFor: (blend: string) => GPURenderPipeline;
}

/** What a mark needs to draw an outline, from a ramp when one is set. */
export function outlinePipelines(ctx: GPUVegaCanvasContext, device: GPUDevice, name: string): OutlinePipelines {
  const vertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
  return {
    name,
    vertexManager,
    pipelineFor: blendPipelines(ctx, device, name, 'SLine', vertexManager),
    gradientPipelineFor: blendPipelines(
      ctx,
      device,
      `${name}Gradient`,
      'SLine',
      vertexManager,
      'main_fragment_gradient',
    ),
  };
}

/**
 * One pipeline per blend mode, for one shader and layout.
 *
 * A blend is baked into the pipeline state, so a mark needs one of these for
 * every mode its items ask for. `markPipeline` caches on the layout rather than
 * the label, so this is a name for that lookup rather than somewhere to keep
 * anything: every mark had written the same four line conditional instead.
 */
export function blendPipelines(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  name: string,
  shader: ShaderKey,
  vertexManager: VertexBufferManager,
  fragmentEntryPoint?: string,
): (blend: string) => GPURenderPipeline {
  return blend => markPipeline(ctx, device, name, shader, vertexManager, fragmentEntryPoint, blend);
}

/**
 * Draws an outline as segments, taking its colour from a ramp when the stroke
 * is a gradient.
 *
 * A gradient stroke used to keep the extruded ribbon, since only that could
 * sample a ramp, and a ribbon carries no dash: a stroke that was both came out
 * solid with the dash silently dropped. The segment shader has a gradient entry
 * now, so both reach the same draw.
 */
export function enqueueOutline(target: DrawTarget, data: Float32Array, ramp: Ramp | null, blend: string): void {
  enqueueDraw(
    target,
    ramp,
    blend,
    [6, data.length / SEGMENT_STRIDE],
    [target.bufferManager.createInstanceBuffer(data)],
  );
}

/** What drawing a clip path's coverage needs. */
interface ClipMaskResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  pipeline: GPURenderPipeline;
}

function getClipMaskResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): ClipMaskResources {
  return getMarkResources(ctx, '__clipMask', device, vb, () => {
    const vertexManager = new VertexBufferManager(['float32x3', 'float32x4']);
    return {
      device,
      bufferManager: new BufferManager(device, 'ClipMask'),
      pipeline: maskPipeline(ctx, device, 'Clip Mask', 'SolidFill', ctx._sampleCount, vertexManager),
    };
  });
}

/**
 * Draws a clip path's coverage into a target of its own and returns it, for
 * the marks inside that clip to be cut by.
 *
 * vega parses `clip: {path}` and `clip: {sphere}` into a generator that draws
 * the path when it is given a context and returns the path when it is not,
 * which is the string this triangulates. Enqueued as a mask run, so the queue
 * lifts it into a pass ahead of everything that reads it.
 */
export function drawClipMask(
  device: GPUDevice,
  ctx: GPUVegaCanvasContext,
  clip: (context?: unknown) => unknown,
  vb: Bounds,
): GPUTextureView | undefined {
  const path = clip();
  if (typeof path !== 'string' || path.length === 0) {
    return undefined;
  }
  const res = getClipMaskResources(device, ctx, vb);
  // Every mark that reads this mask cuts its own corners against the rounded
  // box in force, so folding that in here as well squares its coverage along
  // the arc. The clip mask already in force does belong in it, which is what
  // makes a clip inside a clip the intersection of the two.
  res.bufferManager.setClipRound(undefined);
  const geometry = geometryForItem(ctx, { fill: '#ffffff' } as never, geometryForPath(ctx, path), false, 0, 0);
  const fillData = vertexData(geometry.fillTriangles, geometry.fillCount, [1, 1, 1, 1]);
  if (fillData.length === 0) {
    return undefined;
  }
  // Taken once there is something to draw into it, so a path that triangulates
  // to nothing does not hold a pooled target for the rest of the frame.
  const target = ctx._renderer.acquireClipMask(device, ctx._sampleCount);
  if (!target) {
    return undefined;
  }
  const uniformBuffer = res.bufferManager.createUniformBuffer();
  ctx._renderQueue.enqueue({
    pipeline: res.pipeline,
    drawCounts: [fillData.length / GEOMETRY_STRIDE],
    vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
    bindGroups: [uniformBindGroup(ctx, device, 'ClipMask', res.pipeline, uniformBuffer)],
    pass: 'mask',
    maskView: target.attachment,
    maskResolve: target.resolve,
  });
  return target.read;
}

/** Single channel coverage, which is all a mask holds. */
export const MASK_FORMAT: GPUTextureFormat = 'r8unorm';

/** Coverage drawn into a mask keeps the largest of whatever overlaps there. */
const MAX_COVERAGE: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
};

/** A pipeline that draws coverage into a mask, through the shader's mask entry. */
function maskPipeline(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  label: string,
  shaderKey: ShaderKey,
  sampleCount: number,
  vertexManager: VertexBufferManager,
): GPURenderPipeline {
  return createRenderPipeline(
    label,
    device,
    shaderModule(ctx, device, shaderKey, 'normal'),
    MASK_FORMAT,
    sampleCount,
    vertexManager.getBuffers(),
    MAX_COVERAGE,
    'main_fragment_mask',
  );
}

/** What compositing a stroke through a coverage mask needs. */
interface MaskResources {
  device: GPUDevice;
  /** SLine writing coverage into the mask, where the largest value wins. */
  strokePipeline: GPURenderPipeline;
  /** Paints a colour through a finished mask, one pipeline per blend mode. */
  compositeFor: (blend: string) => GPURenderPipeline;
}

function getMaskResources(device: GPUDevice, ctx: GPUVegaCanvasContext): MaskResources {
  return getMarkResources(ctx, '__mask', device, undefined, () => {
    const vertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
    const strokePipeline = maskPipeline(ctx, device, 'Coverage Mask', 'SLine', 1, vertexManager);
    // a mark pipeline in all but its shader, so a mode the blend state cannot
    // express paints the mask into a layer and is folded in from there
    const compositeFor = blendPipelines(ctx, device, 'Mask Composite', 'MaskComposite', new VertexBufferManager());
    return { device, strokePipeline, compositeFor };
  });
}

/** Pipelines for folding a layer into the frame with its blend evaluated. */
interface BlendResources {
  device: GPUDevice;
  compositeFor: (blend: string) => GPURenderPipeline;
}

function getBlendResources(device: GPUDevice, ctx: GPUVegaCanvasContext): BlendResources {
  return getMarkResources(ctx, '__blend', device, undefined, () => {
    const composites = new Map<string, GPURenderPipeline>();
    const compositeFor = (blend: string): GPURenderPipeline => {
      const held = composites.get(blend);
      if (held) {
        return held;
      }
      const pipeline = createRenderPipeline(
        `Blend Composite ${blend}`,
        device,
        shaderModule(ctx, device, 'BlendComposite', blend),
        preferredColorFormat(),
        ctx._sampleCount,
        [],
        REPLACE,
      );
      composites.set(blend, pipeline);
      return pipeline;
    };
    return { device, compositeFor };
  });
}

/**
 * The draw that folds a layer run back into the frame with its blend evaluated.
 *
 * Everything it needs is the two textures, so the queue can build it for any
 * mark without knowing anything about that mark.
 */
export function blendCompositeElement(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  blend: string,
  clip: ClipRect | undefined,
): QueueElement {
  const pipeline = getBlendResources(device, ctx).compositeFor(blend);
  const targets = ctx._renderer.blendTargets(device, ctx._sampleCount);
  return {
    pipeline,
    drawCounts: [3],
    vertexBuffers: [],
    bindGroups: [
      device.createBindGroup({
        label: 'Blend Composite Bind Group',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: targets.resolve.createView() },
          { binding: 1, resource: targets.backdrop.createView() },
        ],
      }),
    ],
    clip,
  };
}

/** Box the instances cover, in their own space, grown by `reach`. */
function segmentExtent(data: Float32Array, reach: number): [number, number, number, number] {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (let i = 0; i < data.length; i += SEGMENT_STRIDE) {
    x1 = Math.min(x1, data[i], data[i + 2]);
    y1 = Math.min(y1, data[i + 1], data[i + 3]);
    x2 = Math.max(x2, data[i], data[i + 2]);
    y2 = Math.max(y2, data[i + 1], data[i + 3]);
  }
  if (!Number.isFinite(x1)) {
    return [0, 0, 0, 0];
  }
  return [x1 - reach, y1 - reach, x2 - x1 + reach * 2, y2 - y1 + reach * 2];
}

/** How far past an end point a stroke of this item can reach. */
export function strokeReach(item: { strokeWidth?: number; strokeJoin?: string; strokeMiterLimit?: number }): number {
  const half = (item.strokeWidth ?? 1) / 2;
  const { style, miterLimit } = joinStyleOf(item);
  return (style === 'miter' ? half * miterLimit : half) + 2;
}

/**
 * Draws an outline into the coverage mask and composites it once.
 *
 * A stroke whose own bands overlap cannot be composited band by band. vega
 * writes one closed contour per trail segment and consecutive contours overlap,
 * so two antialiased fringes land on the same pixel, and compositing both
 * darkens every joint where canvas fills the union once. The mask keeps the
 * largest coverage each pixel receives, which is that union, and the composite
 * that follows paints it in one go.
 *
 * The quad covers the box the instances reach rather than the frame, so the
 * cost follows the mark and not the canvas.
 */
export function enqueueMaskedOutline(
  target: DrawTarget,
  data: Float32Array,
  blend: string,
  color: RGBA,
  reach: number,
): void {
  const { ctx, device } = target;
  const res = getMaskResources(device, ctx);
  ctx._renderQueue.enqueue({
    pipeline: res.strokePipeline,
    drawCounts: [6, data.length / SEGMENT_STRIDE],
    vertexBuffers: [target.bufferManager.createInstanceBuffer(data)],
    bindGroups: [uniformBindGroup(ctx, device, `${target.name}Mask`, res.strokePipeline, target.uniformBuffer)],
    clip: target.clip,
    pass: 'mask',
  });
  const pipeline = res.compositeFor(blend);
  const rect = segmentExtent(data, reach);
  const params = uploadBuffer(
    device,
    `${target.name} Mask Params`,
    new Float32Array([color[0], color[1], color[2], color[3], rect[0], rect[1], rect[2], rect[3]]),
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  ctx._renderQueue.enqueue({
    pipeline,
    drawCounts: [6],
    vertexBuffers: [],
    bindGroups: [
      uniformBindGroup(ctx, device, `${target.name}Composite`, pipeline, target.uniformBuffer),
      device.createBindGroup({
        label: `${target.name} Mask Bind Group`,
        layout: pipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: ctx._renderer.maskTexture(device).createView() },
          { binding: 1, resource: { buffer: params } },
        ],
      }),
    ],
    clip: target.clip,
  });
}

/**
 * Where strokeRuns draws contours, the way geometryForItem places a fill: scaled
 * first, so the stroke width stays uniform, then turned about the item origin,
 * then moved by dx, dy.
 */
export interface Placement extends Partial<ItemTransform> {
  dx: number;
  dy: number;
}

/**
 * The runs an item's stroke draws: the contours the stroke is extruded from,
 * placed, and cut into dashes when the item has a pattern. Contours that need
 * neither come back untouched.
 */
export function strokeRuns(
  lines: readonly (readonly Point[])[],
  item: { strokeDash?: number[] | null; strokeDashOffset?: number; strokeCap?: string; strokeWidth?: number },
  place?: Placement,
): readonly (readonly Point[])[] {
  const placed = place ? placeContours(lines, place) : lines;
  const pattern = dashPatternOf(item);
  // square caps close the gaps they cover, see bridgeGaps
  const bridge = item.strokeCap === 'square' ? (item.strokeWidth ?? 1) : 0;
  const dash = pattern && prepareDash(pattern, item.strokeDashOffset ?? 0, bridge);
  return dash ? placed.flatMap(line => dashPolyline(line, dash)) : placed;
}

function placeContours(
  lines: readonly (readonly Point[])[],
  { dx, dy, angle = 0, scaleX = 1, scaleY = 1 }: Placement,
): readonly (readonly Point[])[] {
  if (dx === 0 && dy === 0 && angle === 0 && scaleX === 1 && scaleY === 1) {
    return lines;
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return lines.map(line =>
    line.map(([px, py]): Point => {
      const x = px * scaleX;
      const y = py * scaleY;
      return [x * cos - y * sin + dx, x * sin + y * cos + dy];
    }),
  );
}

/**
 * Vertex layout of a single line segment instance, shared by every mark that
 * draws through the SLine shader: line segments, dashes, dashed borders,
 * diagonal rules and shape outlines. The two join fields say how each end
 * finishes, as a flat cut, a round cap or the bisector of a corner, and the
 * last pair how far the neighbour at each end runs.
 */
const SEGMENT_LAYOUT: GPUVertexFormat[] = [
  'float32x2',
  'float32x2',
  'float32x4',
  'float32',
  'float32x4',
  'float32x4',
  'float32x2',
];

/**
 * Floats per segment instance: start, end, colour, width, an end each, and how
 * far the neighbour at each end reaches.
 */
export const SEGMENT_STRIDE = 19;

/** Offsets of the two end fields within an instance, and of the reach pair. */
const START_END = 9;
const END_END = 13;
const REACH = 17;

/**
 * Stands in for a neighbour that does not stop where its own far end is, which
 * is any vertex that is itself a join.
 */
const FAR_REACH = 1e7;

/** How the vertices between a run's ends are joined. */
export interface StrokeJoin {
  style: string;
  miterLimit: number;
}

/** How the runs of an outline end and join, as the segment writers want it. */
export interface StrokeEnds {
  caps: readonly [JoinEnd, JoinEnd];
  join: StrokeJoin;
  /** A square cap, which the writer draws by lengthening the run. */
  square: boolean;
}

/** The caps and join of an item. */
export function strokeEnds(item: { strokeCap?: string; strokeJoin?: string; strokeMiterLimit?: number }): StrokeEnds {
  const cap = capEnd(item.strokeCap);
  return { caps: [cap, cap], join: joinStyleOf(item), square: item.strokeCap === 'square' };
}

/** Packs every segment of every polyline, or null when there is nothing to draw. */
export function segmentInstances(
  runs: readonly (readonly Point[])[],
  color: RGBA,
  width: number,
  ends: StrokeEnds,
): Float32Array | null {
  const count = segmentCount(runs);
  if (count === 0) {
    return null;
  }
  const data = new Float32Array(count * SEGMENT_STRIDE);
  writeSegments(data, 0, runs, color, width, ends);
  return data;
}

/** Segments a set of polyline runs turns into. */
export function segmentCount(runs: readonly (readonly Point[])[]): number {
  let n = 0;
  for (const run of runs) {
    n += Math.max(0, run.length - 1);
  }
  return n;
}

/** The seam of a closed run, held between the two segments that share it. */
const seam = new Float32Array(4);

/**
 * Writes runs as segment instances into `data` at `offset`, returning where it
 * stopped. Field by field rather than through a temporary array, since a
 * choropleth's borders run to hundreds of thousands of segments a frame.
 *
 * `caps` applies to a run's two outer ends, and every vertex between them gets
 * a join. A run that comes back to where it started has no outer end at all:
 * its seam is a vertex like any other, which is what draws the corner there.
 *
 * Two runs whose facing round caps reach each other, which is every gap of a
 * dash narrower than the stroke, have both cut back to the midpoint between
 * them. With equal radii each arc is the outer one on its own side, so the two
 * cuts trace the union's outline exactly and neither draws over the other. Left
 * whole they overlap, which an opaque stroke hides and a blend does not.
 *
 * Each join also carries how far its neighbour runs. A segment gives up the far
 * side of the bisector on the understanding that the other one draws it, which
 * needs the other one to reach up to a half width past the vertex. A dash cut
 * landing nearer than that leaves a stub that cannot, and the sliver was then
 * drawn by neither: the stroke came out cut off along the inside of the corner.
 * Past where the neighbour stops, the cut does not apply.
 */
export function writeSegments(
  data: Float32Array,
  offset: number,
  runs: readonly (readonly Point[])[],
  color: RGBA,
  width: number,
  { caps, join, square }: StrokeEnds,
): number {
  const [r, g, b, a] = color;
  const half = width / 2;
  const { style, miterLimit } = join;
  const meets = capMeetings(runs, width, caps[0]);
  let i = offset;
  for (let ri = 0; ri < runs.length; ri++) {
    const run = runs[ri];
    const n = run.length;
    if (n < 2) {
      continue;
    }
    const startCap = meets[ri * 2] ?? caps[0];
    const endCap = meets[ri * 2 + 1] ?? caps[1];
    const loop = isLoop(run);
    // A square cap is a butt end on a run half a stroke longer at each outer
    // end, which is the same shape and the only cap the segment shader cannot
    // draw on its own.
    const grow = square && !loop ? half : 0;
    if (loop) {
      writeJoin(seam, 0, run[n - 2], run[0], run[1], half, style, miterLimit);
    }
    for (let s = 0; s < n - 1; s++) {
      const p = run[s];
      const q = run[s + 1];
      const [px, py] = grow > 0 && s === 0 ? along(p, q, -grow) : p;
      const [qx, qy] = grow > 0 && s === n - 2 ? along(q, p, -grow) : q;
      data[i] = px;
      data[i + 1] = py;
      data[i + 2] = qx;
      data[i + 3] = qy;
      data[i + 4] = r;
      data[i + 5] = g;
      data[i + 6] = b;
      data[i + 7] = a;
      data[i + 8] = width;
      data[i + REACH] = s === 1 && !loop ? segmentLength(run, 0, grow) : FAR_REACH;
      data[i + REACH + 1] = s === n - 3 && !loop ? segmentLength(run, n - 2, grow) : FAR_REACH;
      if (s > 0) {
        // the vertex is shared, so both sides take the one join written for it
        carryJoin(data, i + END_END - SEGMENT_STRIDE, i + START_END);
      } else if (loop) {
        writeEnd(data, i + START_END, seam as unknown as JoinEnd);
      } else {
        writeEnd(data, i + START_END, startCap);
      }
      if (s < n - 2) {
        writeJoin(data, i + END_END, p, q, run[s + 2], half, style, miterLimit);
      } else if (loop) {
        writeEnd(data, i + END_END, seam as unknown as JoinEnd);
      } else {
        writeEnd(data, i + END_END, endCap);
      }
      i += SEGMENT_STRIDE;
    }
  }
  return i;
}

/** Length of segment `j` of a run, including what a square cap adds to it. */
function segmentLength(run: readonly Point[], j: number, grow: number): number {
  const a = run[j];
  const b = run[j + 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return grow > 0 && (j === 0 || j === run.length - 2) ? len + grow : len;
}

/** `from` moved `by` towards `to`, or away from it when `by` is negative. */
function along(from: Point, to: Point, by: number): Point {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    return from;
  }
  return [from[0] + (dx / len) * by, from[1] + (dy / len) * by];
}

/**
 * Cut-back caps for run ends that meet, indexed as [start, end] per run.
 *
 * Only for a round cap, and only where two ends sit closer together than the
 * stroke is wide, which is every dash gap under that width. Each is cut at the
 * plane halfway to the other, which for equal radii is the union's own outline,
 * so neither draws over it. Around a corner as readily as along a straight run,
 * since the cut follows the line between the two ends and not either direction.
 */
function capMeetings(runs: readonly (readonly Point[])[], width: number, cap: JoinEnd): (JoinEnd | undefined)[] {
  const out: (JoinEnd | undefined)[] = [];
  if (cap[3] !== KIND_ROUND_CAP || width <= 0) {
    return out;
  }
  for (let i = 1; i < runs.length; i++) {
    const before = runs[i - 1];
    const after = runs[i];
    if (before.length < 2 || after.length < 2) {
      continue;
    }
    const from = before[before.length - 1];
    const to = after[0];
    const gx = to[0] - from[0];
    const gy = to[1] - from[1];
    const gap = Math.hypot(gx, gy);
    if (gap <= 1e-9 || gap >= width) {
      continue;
    }
    const ux = gx / gap;
    const uy = gy / gap;
    // a hair apart, so a pixel centred on the plane goes to one of them
    out[(i - 1) * 2 + 1] = [ux, uy, gap / 2, KIND_CAP_MEET];
    out[i * 2] = [-ux, -uy, gap / 2 - 1e-4, KIND_CAP_MEET];
  }
  return out;
}

/** Copies the join written at `from` onto the segment starting at `to`. */
function carryJoin(data: Float32Array, from: number, to: number): void {
  data[to] = data[from];
  data[to + 1] = data[from + 1];
  data[to + 2] = data[from + 2];
  data[to + 3] = data[from + 3];
}

/**
 * vega nudges a group's border by half a pixel when the stroke is about one
 * pixel wide, so the hairline lands on one row of pixels instead of straddling
 * two. Only the background and border move, not the group's contents.
 */
export function withStrokeOffset(item: SceneGroupExt): SceneGroupExt {
  const sw = item.strokeWidth ?? 1;
  const off = item.strokeOffset ?? (item.stroke && sw > 0.5 && sw < 1.5 ? 0.5 - Math.abs(sw - 1) : 0);
  return off === 0 ? item : { ...item, x: (item.x || 0) + off, y: (item.y || 0) + off };
}

/**
 * Rect and group strokes are drawn analytically in the fragment shader, which
 * can express neither a dash pattern nor a ramp. For either the border is
 * walked as a closed polyline instead and emitted as line instances, dashed
 * when a pattern is set and whole when it is not. Returns null when the item
 * has no border this has to draw.
 */
export function borderInstances(ctx: GPUVegaCanvasContext, item: SceneRectExt, ramp: Ramp | null): Float32Array | null {
  if ((!dashPatternOf(item) && !ramp) || !item.stroke) {
    return null;
  }
  const [x, y, w, h] = rectBox(item);
  if (w <= 0 || h <= 0) {
    return null;
  }
  const outline = roundedBorder(ctx, item, x, y, w, h) ?? [
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ] as Point[],
  ];
  const color = paintColour(item.stroke, item.opacity, item.strokeOpacity, ramp);
  return segmentInstances(strokeRuns(outline, item), color, item.strokeWidth ?? 1, strokeEnds(item));
}

const borderPath = pathRectangle<SceneRectExt>();

/**
 * The border as contours, when a corner radius rounds it, and null when the box
 * is square and the four straight sides are already exact.
 *
 * The path comes from vega's own rect generator, so the curve, where it starts
 * and which way it runs are the ones canvas dashes along. Walking the box as
 * four straight sides instead gave a group with both a radius and a dash a
 * dashed sharp rectangle.
 */
function roundedBorder(
  ctx: GPUVegaCanvasContext,
  item: SceneRectExt,
  x: number,
  y: number,
  w: number,
  h: number,
): Point[][] | null {
  const r = item.cornerRadius ?? 0;
  const tl = item.cornerRadiusTopLeft ?? r;
  const tr = item.cornerRadiusTopRight ?? r;
  const br = item.cornerRadiusBottomRight ?? r;
  const bl = item.cornerRadiusBottomLeft ?? r;
  if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0) {
    return null;
  }
  const path = borderPath.width(w).height(h).cornerRadius(tl, tr, br, bl)(item, x, y);
  return path ? geometryForPath(ctx, path, DASH_FLATNESS).lines : null;
}

/**
 * Per-item geometry cache, shared by the marks that triangulate. Rebuilding the
 * vertex data every frame is what makes a re-render cost multiples of canvas,
 * and the geometry only changes when the item's position, size or path does.
 */
export interface CacheableItem {
  x?: number;
  y?: number;
  bounds?: Bounds;
  strokeWidth?: number;
  path?: string;
  angle?: number;
  scaleX?: number;
  scaleY?: number;
  datum?: { id?: unknown };
  id?: unknown;
}

export type BoundsSnapshot = { x1: number; y1: number; x2: number; y2: number };

export interface GeometryCacheEntry {
  fill: RGBA;
  x?: number;
  y?: number;
  bounds?: BoundsSnapshot;
  strokeWidth?: number;
  path?: string;
  angle?: number;
  scaleX?: number;
  scaleY?: number;
  data: Float32Array;
}

export type GeometryCache = Map<unknown, GeometryCacheEntry>;

// Bounds a per-context geometry cache so a streaming session, where every
// frame brings new datum ids, cannot grow one without limit.
export const MAX_GEOMETRY_CACHE = 4096;

/** Identifies an item across frames: vega keeps tuple ids on a symbol. */
function cacheKey(item: CacheableItem): unknown {
  if (item.datum?.id != null) {
    return item.datum.id;
  }
  if (item.id != null) {
    return item.id;
  }
  const symbols = Object.getOwnPropertySymbols(item);
  return symbols.length > 0 ? (item as unknown as Record<symbol, unknown>)[symbols[0]] : item;
}

/**
 * Vega mutates a Bounds in place as the view pans or zooms, so comparing by
 * identity never sees a change. Snapshot the numbers and compare those.
 */
export function copyBounds(b?: Bounds): BoundsSnapshot | undefined {
  return b ? { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 } : undefined;
}

/**
 * A projection can send a shape outside its domain and leave NaN in its
 * bounds. Compared with `===` those items never match their own snapshot and
 * rebuild on every frame.
 */
export function sameBounds(b: Bounds | undefined, snap: BoundsSnapshot | undefined): boolean {
  if (!b || !snap) {
    return b === undefined && snap === undefined;
  }
  return sameEdge(b.x1, snap.x1) && sameEdge(b.y1, snap.y1) && sameEdge(b.x2, snap.x2) && sameEdge(b.y2, snap.y2);
}

function sameEdge(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

export function sameColor(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Copies positions from `source` and writes `color` into every vertex. */
export function recolor(data: Float32Array, source: Float32Array, color: RGBA): void {
  for (let i = 0; i < data.length; i += GEOMETRY_STRIDE) {
    data[i] = source[i];
    data[i + 1] = source[i + 1];
    data[i + 2] = source[i + 2];
    data[i + 3] = color[0];
    data[i + 4] = color[1];
    data[i + 5] = color[2];
    data[i + 6] = color[3];
  }
}

/**
 * Returns the item's fill vertex data, building it only when the geometry
 * changed. A colour-only change rewrites the colours over the cached positions
 * instead of triangulating again.
 */
export function cachedGeometryData(
  cache: GeometryCache,
  item: CacheableItem,
  fill: RGBA,
  build: () => Float32Array,
): Float32Array {
  const key = cacheKey(item);
  const entry = cache.get(key);
  if (
    entry &&
    item.strokeWidth === entry.strokeWidth &&
    item.x === entry.x &&
    item.y === entry.y &&
    item.path === entry.path &&
    item.angle === entry.angle &&
    item.scaleX === entry.scaleX &&
    item.scaleY === entry.scaleY &&
    sameBounds(item.bounds, entry.bounds)
  ) {
    // re-insert to keep the map in least-recently-used order
    cache.delete(key);
    cache.set(key, entry);
    if (sameColor(entry.fill, fill)) {
      return entry.data;
    }
    const data = new Float32Array(entry.data.length);
    recolor(data, entry.data, fill);
    return data;
  }

  const data = build();
  if (cache.size >= MAX_GEOMETRY_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, {
    fill,
    x: item.x,
    y: item.y,
    bounds: copyBounds(item.bounds),
    strokeWidth: item.strokeWidth,
    path: item.path,
    angle: item.angle,
    scaleX: item.scaleX,
    scaleY: item.scaleY,
    data,
  });
  return data;
}
