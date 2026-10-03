import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneItem, SceneRectExt } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import {
  rectBox,
  outlinePipelines,
  type OutlinePipelines,
  borderInstances,
  enqueueDraw,
  enqueueOutline,
  getMarkResources,
  instanceScratch,
  markItems,
  blendPipelines,
  whiteCarrier,
  type MarkModule,
  boxRampOf,
  targetOf,
  type DrawTarget,
  type Ramp,
} from './util.js';
import { DrawRun } from '../util/drawRun.js';

const drawName = 'Rect';

/** What a rect, or a group's background, draws with. */
export interface RectResources {
  device: GPUDevice;
  /** Labels the pipelines and the bind groups made from them. */
  name: string;
  bufferManager: BufferManager;
  /** The box, one pipeline per blend mode. */
  pipelineFor: (blend: string) => GPURenderPipeline;
  gradientPipelineFor: (blend: string) => GPURenderPipeline;
  geometryBuffer: GPUBuffer;
  /** Pipelines for an outline drawn through the segment shader. */
  outline: OutlinePipelines;
}

export function rectResources(ctx: GPUVegaCanvasContext, device: GPUDevice, vb: Bounds, name: string): RectResources {
  return getMarkResources(ctx, name.toLowerCase(), device, vb, () => {
    const bufferManager = new BufferManager(device, name);
    const vertexManager = new VertexBufferManager(
      ['float32x2'], // position
      // center, dimensions, fill color, stroke color, stroke width, corner radii
      ['float32x2', 'float32x2', 'float32x4', 'float32x4', 'float32', 'float32x4'],
    );
    return {
      device,
      name,
      bufferManager,
      pipelineFor: blendPipelines(ctx, device, name, 'Rect', vertexManager),
      // a gradient fill under a blend needs its own pipeline too
      gradientPipelineFor: blendPipelines(
        ctx,
        device,
        `${name}Gradient`,
        'Rect',
        vertexManager,
        'main_fragment_gradient',
      ),
      geometryBuffer: bufferManager.createGeometryBuffer(quadVertex, true),
      // The analytic stroke cannot express a pattern, so a dashed border is
      // walked as a polyline and drawn as segments.
      outline: outlinePipelines(ctx, device, `${name}Dash`),
    };
  });
}

/**
 * Draws boxes in the order they are painted: fills in runs, and a ramp fill or
 * a border drawn as segments on its own.
 */
export class BoxPainter {
  private readonly fill: DrawTarget;
  private readonly outline: DrawTarget;
  private readonly run: DrawRun<SceneRectExt>;

  constructor(
    ctx: GPUVegaCanvasContext,
    device: GPUDevice,
    private readonly res: RectResources,
  ) {
    const uniformBuffer = res.bufferManager.createUniformBuffer();
    this.fill = targetOf(ctx, device, res.name, res, res.bufferManager, uniformBuffer);
    this.outline = targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, uniformBuffer);
    this.run = new DrawRun(ctx._opaqueBackdrop, (boxes, blend) => this.enqueue(boxes, null, blend));
  }

  /** A box's fill, and its stroke when the analytic one draws it. */
  paint(box: SceneRectExt, fillRamp: Ramp | null, blend: string): void {
    if (fillRamp) {
      this.run.flush();
      this.enqueue([box], fillRamp, blend);
    } else {
      this.run.add(box, blend);
    }
  }

  /** A border drawn as segments, over everything painted before it. */
  border(data: Float32Array, ramp: Ramp | null, blend: string): void {
    this.run.flush();
    enqueueOutline(this.outline, data, ramp, blend);
  }

  flush(): void {
    this.run.flush();
  }

  private enqueue(boxes: SceneRectExt[], ramp: Ramp | null, blend: string): void {
    const instances = this.res.bufferManager.createInstanceBuffer(rectAttributes(boxes, ramp !== null));
    enqueueDraw(this.fill, ramp, blend, [6, boxes.length], [this.res.geometryBuffer, instances]);
  }
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = markItems<SceneRectExt>(scene);
  if (items.length === 0) {
    return;
  }

  const painter = new BoxPainter(ctx, device, rectResources(ctx, device, vb, drawName));
  for (const item of items) {
    const blend = blendKey(item.blend);
    const strokeRamp = boxRampOf(item.stroke, item);
    const border = borderInstances(ctx, item, strokeRamp);
    // A dash or a ramp takes the border off the analytic path, and the stroke
    // comes off the fill with it so it is not drawn solid underneath. The fill
    // goes first, which is the order canvas paints them in.
    painter.paint(border ? { ...item, stroke: undefined } : item, boxRampOf(item.fill, item), blend);
    if (border) {
      painter.border(border, strokeRamp, blend);
    }
  }
  painter.flush();
}

/** Floats per rect instance: box, fill, stroke, stroke width, four radii. */
const RECT_STRIDE = 17;

export function rectAttributes(items: SceneItem[], whiteGradientFill = false): Float32Array {
  const out = instanceScratch(items.length * RECT_STRIDE);
  for (let i = 0, len = items.length; i < len; i++) {
    const item = items[i] as SceneRectExt;
    const {
      opacity = 1,
      fill,
      fillOpacity = 1,
      stroke,
      strokeOpacity = 1,
      strokeWidth,
      cornerRadius = 0,
      cornerRadiusBottomLeft,
      cornerRadiusBottomRight,
      cornerRadiusTopRight,
      cornerRadiusTopLeft,
    } = item;
    // a quad built from a negative extent would be inverted and draw nothing
    const [x, y, width, height] = rectBox(item);
    const base = i * RECT_STRIDE;
    out[base] = x;
    out[base + 1] = y;
    out[base + 2] = width;
    out[base + 3] = height;
    if (whiteGradientFill && isGradient(fill)) {
      const [r, g, b, a] = whiteCarrier(opacity, fillOpacity);
      out[base + 4] = r;
      out[base + 5] = g;
      out[base + 6] = b;
      out[base + 7] = a;
    } else {
      Color.write(out, base + 4, fill, opacity, fillOpacity);
    }
    Color.write(out, base + 8, stroke, opacity, strokeOpacity);
    // Only reserve stroke width when a stroke is actually painted. Vega marks
    // may carry a strokeWidth with no stroke (e.g. stroke set on hover only);
    // canvas ignores it, so we must too. Otherwise the transparent stroke
    // band insets the fill and the rect renders ~strokeWidth/2 px too small.
    out[base + 12] = stroke ? (strokeWidth ?? 1) : 0;
    out[base + 13] = cornerRadiusTopRight ?? cornerRadius;
    out[base + 14] = cornerRadiusBottomRight ?? cornerRadius;
    out[base + 15] = cornerRadiusBottomLeft ?? cornerRadius;
    out[base + 16] = cornerRadiusTopLeft ?? cornerRadius;
  }
  return out;
}

export default { draw } satisfies MarkModule;
