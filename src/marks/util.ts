import { type Bounds, pathRectangle } from 'vega-scenegraph';
import geometryForPath, { DASH_FLATNESS } from '../path/geometryForPath.js';
import { BufferManager } from '../util/bufferManager.js';
import { dashPolyline, type Point } from '../util/dash.js';
import {
  BUTT_END,
  DEFAULT_MITER_LIMIT,
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
import type { QueueElement } from '../util/renderQueue.js';
import type { ItemGeometry } from '../types/geometry.js';
import type { SceneGroupExt, SceneRectExt } from '../types/scene.js';
import { Color, type RGBA } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import type { SceneGradient } from '../types/scene.js';
import type WebGPURenderer from '../WebGPURenderer.js';

/** A mark renderer module, as registered in marks/index.ts. */
export interface MarkModule {
  type: string;
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
  }
  return res;
}

/**
 * Interleaves triangulated fill and stroke geometry with their colors
 * into [x, y, z, r, g, b, a] vertex buffers.
 */
export function geometryVertexData(
  geometry: ItemGeometry,
  fill: RGBA,
  stroke: RGBA,
): [fillData: Float32Array, strokeData: Float32Array] {
  const fillData = new Float32Array(geometry.fillCount * 7);
  const strokeData = new Float32Array(geometry.strokeCount * 7);
  for (let i = 0; i < geometry.fillCount; i++) {
    fillData[i * 7] = geometry.fillTriangles[i * 3];
    fillData[i * 7 + 1] = geometry.fillTriangles[i * 3 + 1];
    fillData[i * 7 + 2] = geometry.fillTriangles[i * 3 + 2] * -1;
    fillData[i * 7 + 3] = fill[0];
    fillData[i * 7 + 4] = fill[1];
    fillData[i * 7 + 5] = fill[2];
    fillData[i * 7 + 6] = fill[3];
  }
  for (let i = 0; i < geometry.strokeCount; i++) {
    strokeData[i * 7] = geometry.strokeTriangles[i * 3];
    strokeData[i * 7 + 1] = geometry.strokeTriangles[i * 3 + 1];
    strokeData[i * 7 + 2] = geometry.strokeTriangles[i * 3 + 2] * -1;
    strokeData[i * 7 + 3] = stroke[0];
    strokeData[i * 7 + 4] = stroke[1];
    strokeData[i * 7 + 5] = stroke[2];
    strokeData[i * 7 + 6] = stroke[3];
  }
  return [fillData, strokeData];
}

/**
 * Scissor rect for a mark, in physical pixels. Marks with `clip: true`
 * are clipped to their enclosing group. Otherwise the inherited group
 * clip (if any) applies.
 */
export function markClip(ctx: GPUVegaCanvasContext, scene: GPUVegaScene): ClipRect | undefined {
  if (!scene.clip) {
    return ctx._clip;
  }
  const group = scene.group;
  if (!group) {
    return ctx._clip;
  }
  const dpi = ctx._uniforms.dpi;
  return [
    (ctx._origin[0] + ctx._tx) * dpi,
    (ctx._origin[1] + ctx._ty) * dpi,
    (group.width || 0) * dpi,
    (group.height || 0) * dpi,
  ];
}

/**
 * An item's bounding box in the same coordinate space as its triangulated
 * vertices (group translation applied), as [x, y, w, h] for gradients.
 */
export function gradientBounds(ctx: GPUVegaCanvasContext, bounds: Bounds): [number, number, number, number] {
  return [bounds.x1 + ctx._tx, bounds.y1 + ctx._ty, Math.max(bounds.width(), 1e-6), Math.max(bounds.height(), 1e-6)];
}

/** Fill color for vertex data: white carrier with opacity when a gradient is used. */
export function whiteCarrier(opacity = 1, fillOpacity = 1): RGBA {
  return [1, 1, 1, opacity * fillOpacity];
}

/** What a mark needs to paint triangulated geometry from a gradient ramp. */
export interface DrawTarget {
  ctx: GPUVegaCanvasContext;
  device: GPUDevice;
  name: string;
  pipelineFor: (blend: string) => GPURenderPipeline;
  bufferManager: BufferManager;
  uniformBuffer: GPUBuffer;
  vertexLength: number;
  clip: ClipRect | undefined;
}

/**
 * Where a mark sends geometry that takes its colour from a ramp. Five marks
 * wrote the same eight fields.
 */
export function gradientTargetOf(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  name: string,
  res: {
    gradientPipelineFor: (blend: string) => GPURenderPipeline;
    bufferManager: BufferManager;
    vertexManager: VertexBufferManager;
  },
  uniformBuffer: GPUBuffer,
  clip: ClipRect | undefined,
): DrawTarget {
  return {
    ctx,
    device,
    name,
    pipelineFor: res.gradientPipelineFor,
    bufferManager: res.bufferManager,
    uniformBuffer,
    vertexLength: res.vertexManager.getVertexLength(),
    clip,
  };
}

/** Draws geometry whose color comes from a ramp rather than its vertices. */
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

/** Where a mark's outline is enqueued, solid or from a ramp. */
export function outlineTargetOf(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  res: { outline: OutlinePipelines; bufferManager: BufferManager },
  uniformBuffer: GPUBuffer,
  clip: ClipRect | undefined,
): OutlineTarget {
  return { ...res.outline, ctx, device, bufferManager: res.bufferManager, uniformBuffer, clip };
}

/** The same target, drawing a flat colour rather than sampling a ramp. */
export function solidTargetOf(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  name: string,
  res: {
    pipelineFor: (blend: string) => GPURenderPipeline;
    bufferManager: BufferManager;
    vertexManager: VertexBufferManager;
  },
  uniformBuffer: GPUBuffer,
  clip: ClipRect | undefined,
): DrawTarget {
  return {
    ctx,
    device,
    name,
    pipelineFor: res.pipelineFor,
    bufferManager: res.bufferManager,
    uniformBuffer,
    vertexLength: res.vertexManager.getVertexLength(),
    clip,
  };
}

/** Queues one buffer of triangles at a flat colour. */
export function enqueueSolid(target: DrawTarget, data: Float32Array, blend = 'normal'): void {
  const { ctx, device } = target;
  const pipeline = target.pipelineFor(blend);
  ctx._renderQueue.enqueue({
    pipeline,
    drawCounts: [data.length / target.vertexLength],
    vertexBuffers: [target.bufferManager.createGeometryBuffer(data)],
    bindGroups: [createUniformBindGroup(target.name, device, pipeline, target.uniformBuffer)],
    clip: target.clip,
  });
}

export function enqueueGradient(
  target: DrawTarget,
  data: Float32Array,
  gradient: SceneGradient,
  bounds: Bounds,
  blend = 'normal',
): void {
  const { ctx, device } = target;
  const pipeline = target.pipelineFor(blend);
  ctx._renderQueue.enqueue({
    pipeline,
    drawCounts: [data.length / target.vertexLength],
    vertexBuffers: [target.bufferManager.createGeometryBuffer(data)],
    bindGroups: [
      createUniformBindGroup(target.name, device, pipeline, target.uniformBuffer),
      createGradientBindGroup(getGradientResources(device, ctx), pipeline, gradient, gradientBounds(ctx, bounds)),
    ],
    clip: target.clip,
  });
}

/**
 * Accumulates the vertex data of consecutive items that share one pipeline
 * so a whole mark renders as a single buffer and draw call. Data is appended
 * in paint order (fill then stroke, item by item), preserving canvas
 * rendering semantics for overlapping items.
 */
export class GeometryBatch {
  private chunks: Float32Array[] = [];
  private total = 0;

  push(data: Float32Array): void {
    if (data.length > 0) {
      this.chunks.push(data);
      this.total += data.length;
    }
  }

  /** Concatenated data, or null when nothing was pushed. Resets the batch. */
  flush(): Float32Array | null {
    if (this.total === 0) {
      return null;
    }
    const out = new Float32Array(this.total);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    this.total = 0;
    return out;
  }
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
  const bufferManager = new BufferManager(device, name, ctx._uniforms.resolution, [vb.x1, vb.y1]);
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

export interface OutlineTarget extends OutlinePipelines {
  ctx: GPUVegaCanvasContext;
  device: GPUDevice;
  bufferManager: BufferManager;
  uniformBuffer: GPUBuffer;
  clip: ClipRect | undefined;
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
export function enqueueOutline(
  target: OutlineTarget,
  data: Float32Array,
  blend: string,
  gradient: SceneGradient | null,
  bounds: Bounds | undefined,
): void {
  const { ctx, device } = target;
  const ramp = gradient !== null && bounds !== undefined;
  const pipeline = ramp ? target.gradientPipelineFor(blend) : target.pipelineFor(blend);
  const bindGroups = [createUniformBindGroup(target.name, device, pipeline, target.uniformBuffer)];
  if (ramp) {
    bindGroups.push(
      createGradientBindGroup(
        getGradientResources(device, ctx),
        pipeline,
        gradient,
        gradientBounds(ctx, bounds as Bounds),
      ),
    );
  }
  ctx._renderQueue.enqueue({
    pipeline,
    drawCounts: [6, data.length / SEGMENT_STRIDE],
    vertexBuffers: [target.bufferManager.createInstanceBuffer(data)],
    bindGroups,
    clip: target.clip,
  });
}

/** Single channel coverage, which is all a mask holds. */
const MASK_FORMAT: GPUTextureFormat = 'r8unorm';

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
    const strokePipeline = createRenderPipeline(
      'Coverage Mask',
      device,
      shaderModule(ctx, device, 'SLine', 'normal'),
      MASK_FORMAT,
      1,
      vertexManager.getBuffers(),
      {
        color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
      },
      'main_fragment_mask',
    );
    const composites = new Map<string, GPURenderPipeline>();
    const compositeFor = (blend: string): GPURenderPipeline => {
      const key = `${blend}|${ctx._opaqueBackdrop}`;
      const held = composites.get(key);
      if (held) {
        return held;
      }
      // The same routing a mark pipeline gets: a mode the blend state cannot
      // express paints the mask into a layer and is folded in from there.
      const built = buildBlend(blend, ctx._opaqueBackdrop);
      const pipeline = createRenderPipeline(
        `Mask Composite ${blend}`,
        device,
        shaderModule(ctx, device, 'MaskComposite', built.blend),
        preferredColorFormat(),
        ctx._sampleCount,
        [],
        blendState(built.blend),
      );
      built.record(pipeline);
      composites.set(key, pipeline);
      return pipeline;
    };
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
  const targets = ctx._renderer.blendTargets(device);
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
  target: OutlineTarget,
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
    bindGroups: [createUniformBindGroup(`${target.name}Mask`, device, res.strokePipeline, target.uniformBuffer)],
    clip: target.clip,
    pass: 'mask',
  });
  const pipeline = res.compositeFor(blend);
  const rect = segmentExtent(data, reach);
  const params = target.bufferManager.createBuffer(
    `${target.name} Mask Params`,
    new Float32Array([color[0], color[1], color[2], color[3], rect[0], rect[1], rect[2], rect[3]]),
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  ctx._renderQueue.enqueue({
    pipeline,
    drawCounts: [6],
    vertexBuffers: [],
    bindGroups: [
      createUniformBindGroup(`${target.name}Composite`, device, pipeline, target.uniformBuffer),
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
 * A mark's outline as segment instances, dashed when a pattern is given.
 *
 * The contours are the same ones the stroke is extruded from, so this follows
 * exactly the line a solid stroke would draw. The transform matches
 * geometryForItem: scale first, so the stroke width stays uniform, then rotate
 * about the item origin, then translate.
 */
export function strokeOutline(
  lines: readonly (readonly (readonly [number, number])[])[],
  pattern: number[] | null,
  color: RGBA,
  width: number,
  offset = 0,
  dx = 0,
  dy = 0,
  transform: { angle: number; scaleX: number; scaleY: number } = { angle: 0, scaleX: 1, scaleY: 1 },
  ends?: { caps: readonly [JoinEnd, JoinEnd]; join: StrokeJoin; bridge?: number; square?: boolean },
): Float32Array | null {
  const { angle, scaleX, scaleY } = transform;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const runs: Point[][] = [];
  for (const line of lines) {
    const moved: Point[] = line.map(([px, py]) => {
      const x = px * scaleX;
      const y = py * scaleY;
      return [x * cos - y * sin + dx, x * sin + y * cos + dy];
    });
    if (pattern) {
      runs.push(...dashPolyline(moved, pattern, offset, ends?.bridge ?? 0));
    } else {
      runs.push(moved);
    }
  }
  return segmentInstances(runs, color, width, ends?.caps, ends?.join, ends?.square);
}

/**
 * Vertex layout of a single line segment instance, shared by every mark that
 * draws through the SLine shader: line segments, dashes, dashed borders,
 * diagonal rules and shape outlines. The two join fields say how each end
 * finishes, as a flat cut, a round cap or the bisector of a corner, and the
 * last pair how far the neighbour at each end runs.
 */
export const SEGMENT_LAYOUT: GPUVertexFormat[] = [
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

const MITER: StrokeJoin = { style: 'miter', miterLimit: DEFAULT_MITER_LIMIT };
const BUTT_CAPS: readonly [JoinEnd, JoinEnd] = [BUTT_END, BUTT_END];

/** The caps and join of an item, as the segment writers want them. */
export function strokeEnds(item: {
  strokeCap?: string;
  strokeJoin?: string;
  strokeMiterLimit?: number;
  strokeWidth?: number;
}): {
  caps: readonly [JoinEnd, JoinEnd];
  join: StrokeJoin;
  /** How much of a dash gap this item's caps close over. See dash.ts. */
  bridge: number;
  /** A square cap, which the writer draws by lengthening the run. */
  square: boolean;
} {
  const cap = capEnd(item.strokeCap);
  // Square only. Two square caps facing each other across a gap they cover fill
  // it exactly, so merging the runs is the same shape. Two round ones do not:
  // their arcs cross short of the stroke edge and leave a notch either side,
  // which a merged run would paint over.
  const square = item.strokeCap === 'square';
  const bridge = square ? (item.strokeWidth ?? 1) : 0;
  return { caps: [cap, cap], join: joinStyleOf(item), bridge, square };
}

/** Packs every segment of every polyline, or null when there is nothing to draw. */
export function segmentInstances(
  runs: readonly (readonly Point[])[],
  color: RGBA,
  width: number,
  caps: readonly [JoinEnd, JoinEnd] = BUTT_CAPS,
  join: StrokeJoin = MITER,
  square = false,
): Float32Array | null {
  const count = segmentCount(runs);
  if (count === 0) {
    return null;
  }
  const data = new Float32Array(count * SEGMENT_STRIDE);
  writeSegments(data, 0, runs, color, width, caps, join, square);
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
  caps: readonly [JoinEnd, JoinEnd] = BUTT_CAPS,
  join: StrokeJoin = MITER,
  square = false,
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
export function borderInstances(
  ctx: GPUVegaCanvasContext,
  item: SceneRectExt,
  gradient: SceneGradient | null,
): Float32Array | null {
  const pattern = dashPatternOf(item);
  if ((!pattern && !gradient) || !item.stroke) {
    return null;
  }
  // the same flip canvas's strokeRect applies, see rectAttributes
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
  if (w <= 0 || h <= 0) {
    return null;
  }
  const offset = item.strokeDashOffset ?? 0;
  const outline = roundedBorder(ctx, item, x, y, w, h) ?? [
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ] as Point[],
  ];
  const { caps, join, bridge, square } = strokeEnds(item);
  const runs = pattern ? outline.flatMap(line => dashPolyline(line, pattern, offset, bridge)) : outline;
  const color = gradient
    ? whiteCarrier(item.opacity, item.strokeOpacity)
    : Color.from(item.stroke, item.opacity, item.strokeOpacity);
  return segmentInstances(runs, color, item.strokeWidth ?? 1, caps, join, square);
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
  return path ? (geometryForPath(ctx, path, DASH_FLATNESS).lines as Point[][]) : null;
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
  stroke: RGBA;
  x?: number;
  y?: number;
  bounds?: BoundsSnapshot;
  strokeWidth?: number;
  path?: string;
  angle?: number;
  scaleX?: number;
  scaleY?: number;
  data: [Float32Array, Float32Array];
}

export type GeometryCache = Map<unknown, GeometryCacheEntry>;

// Bounds the cache so a streaming session, where every frame brings new datum
// ids, cannot grow it without limit.
const MAX_GEOMETRY_CACHE = 4096;

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
  for (let i = 0; i < data.length; i += 7) {
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
 * Returns the item's vertex data, building it only when the geometry changed.
 * A colour-only change rewrites the colours over the cached positions instead
 * of triangulating again.
 */
export function cachedGeometryData(
  cache: GeometryCache,
  item: CacheableItem,
  fill: RGBA,
  stroke: RGBA,
  build: () => [Float32Array, Float32Array],
): [Float32Array, Float32Array] {
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
    if (sameColor(entry.fill, fill) && sameColor(entry.stroke, stroke)) {
      return entry.data;
    }
    const data: [Float32Array, Float32Array] = [
      new Float32Array(entry.data[0].length),
      new Float32Array(entry.data[1].length),
    ];
    recolor(data[0], entry.data[0], fill);
    recolor(data[1], entry.data[1], stroke);
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
    stroke,
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
