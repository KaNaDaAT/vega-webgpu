import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneArcItem } from '../types/scene.js';
import { arc } from '../path/shapes.js';
import { DASH_FLATNESS } from '../path/geometryForPath.js';
import geometryForItem from '../path/geometryForItem.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  GeometryBatch,
  dashPatternOf,
  strokeAsSegments,
  strokeOutline,
  enqueueOutline,
  type OutlineTarget,
  strokeEnds,
  geometryVertexData,
  getMarkResources,
  gradientTargetOf,
  enqueueGradient,
  markClip,
  fillResources,
  type FillResources,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Arc';

type ArcResources = FillResources;

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): ArcResources {
  return getMarkResources(ctx, 'arc', device, vb, () => ({
    ...fillResources(ctx, device, vb, drawName),
  }));
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as SceneArcItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const clip = markClip(ctx, scene);
  const vertexLength = res.vertexManager.getVertexLength();
  const gradientTarget = gradientTargetOf(ctx, device, `${drawName}Gradient`, res, uniformBuffer, clip);

  const outlineTarget: OutlineTarget = {
    ...res.outline,
    ctx,
    device,
    bufferManager: res.bufferManager,
    uniformBuffer,
    clip,
  };

  // Solid fills and strokes share one pipeline and are accumulated in paint
  // order into a single buffer/draw. Gradient fills interrupt the batch.
  const batch = new GeometryBatch();
  // one batch draws with one pipeline, so a change of blend closes it
  let batchBlend = 'normal';
  const flushBatch = () => {
    const data = batch.flush();
    if (data) {
      const pipeline = res.pipelineFor(batchBlend);
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [data.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(data)],
        bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer)],
        clip,
      });
    }
  };

  for (const item of items) {
    const blend = blendKey(item.blend);
    if (blend !== batchBlend) {
      flushBatch();
      batchBlend = blend;
    }
    const bounds = item.bounds;
    const gradient = isGradient(item.fill) && bounds ? item.fill : null;
    const fill = gradient
      ? whiteCarrier(item.opacity, item.fillOpacity)
      : Color.from2(item.fill, item.opacity, item.fillOpacity);
    const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
    const stroke = strokeGradient
      ? whiteCarrier(item.opacity, item.strokeOpacity)
      : Color.from2(item.stroke, item.opacity, item.strokeOpacity);

    // Neither a dash nor a round cap can come out of an extruded ribbon, so the
    // outline is walked and drawn as segments, and the solid stroke is left off
    // the geometry.
    const dash = dashPatternOf(item);
    const outlined = strokeAsSegments(item);
    const shapeGeom = arc(ctx, item);
    // arc paths are generated around the origin, so bake the item center in
    const geometry = geometryForItem(
      ctx,
      outlined ? { ...item, stroke: undefined } : item,
      shapeGeom,
      false,
      item.x || 0,
      item.y || 0,
    );
    const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);

    if (fillData.length > 0 && gradient && bounds) {
      flushBatch();
      enqueueGradient(gradientTarget, fillData, gradient, bounds, blendKey(item.blend));
    } else {
      batch.push(fillData);
    }
    if (strokeData.length > 0 && strokeGradient && bounds) {
      flushBatch();
      enqueueGradient(gradientTarget, strokeData, strokeGradient, bounds, blendKey(item.blend));
    } else {
      batch.push(strokeData);
    }

    // After the fill, which is the order canvas paints them in.
    if (outlined && item.stroke) {
      const data = strokeOutline(
        dash ? arc(ctx, item, DASH_FLATNESS).lines : shapeGeom.lines,
        dash,
        stroke,
        item.strokeWidth ?? 1,
        item.strokeDashOffset ?? 0,
        item.x || 0,
        item.y || 0,
        undefined,
        strokeEnds(item),
      );
      if (data) {
        flushBatch();
        enqueueOutline(outlineTarget, data, blendKey(item.blend), strokeGradient, bounds);
      }
    }
  }
  flushBatch();
}

export default {
  type: 'arc',
  draw,
} satisfies MarkModule;
