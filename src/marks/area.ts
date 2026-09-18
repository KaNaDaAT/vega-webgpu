import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneAreaItem } from '../types/scene.js';
import { area } from '../path/shapes.js';
import { DASH_FLATNESS } from '../path/geometryForPath.js';
import geometryForItem from '../path/geometryForItem.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  dashPatternOf,
  strokeAsSegments,
  strokeOutline,
  enqueueOutline,
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

const drawName = 'Area';

type AreaResources = FillResources;

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): AreaResources {
  return getMarkResources(ctx, 'area', device, vb, () => ({
    ...fillResources(ctx, device, vb, drawName),
  }));
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as SceneAreaItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);

  // An area mark renders all its items as one shape.
  const item = items[0];
  const pipeline = res.pipelineFor(blendKey(item.blend));
  const bounds = scene.bounds ?? item.bounds;
  const gradient = isGradient(item.fill) && bounds ? item.fill : null;
  const fill = gradient
    ? whiteCarrier(item.opacity, item.fillOpacity)
    : Color.from2(item.fill, item.opacity, item.fillOpacity);
  const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
  const stroke = strokeGradient
    ? whiteCarrier(item.opacity, item.strokeOpacity)
    : Color.from2(item.stroke, item.opacity, item.strokeOpacity);

  // Neither a dash nor a round cap can come out of an extruded ribbon, so
  // the outline is walked and drawn as segments, and the solid stroke is
  // left off the geometry.
  const dash = dashPatternOf(item);
  const outlined = strokeAsSegments(item);
  const shapeGeom = area(ctx, items);
  const geometry = geometryForItem(ctx, outlined ? { ...item, stroke: undefined } : item, shapeGeom, true);
  const [fillData, strokeData] = geometryVertexData(geometry, fill, stroke);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const clip = markClip(ctx, scene);
  const vertexLength = res.vertexManager.getVertexLength();
  const gradientTarget = gradientTargetOf(ctx, device, `${drawName}Gradient`, res, uniformBuffer, clip);

  if (fillData.length > 0) {
    if (gradient && bounds) {
      enqueueGradient(gradientTarget, fillData, gradient, bounds, blendKey(item.blend));
    } else {
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [fillData.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
        bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer)],
        clip,
      });
    }
  }

  if (strokeData.length > 0) {
    if (strokeGradient && bounds) {
      enqueueGradient(gradientTarget, strokeData, strokeGradient, bounds, blendKey(item.blend));
    } else {
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [strokeData.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(strokeData)],
        bindGroups: [createUniformBindGroup(drawName, device, pipeline, uniformBuffer)],
        clip,
      });
    }
  }

  // After the fill, which is the order canvas paints them in.
  if (outlined && item.stroke) {
    const data = strokeOutline(
      dash ? area(ctx, items, DASH_FLATNESS).lines : shapeGeom.lines,
      dash,
      stroke,
      item.strokeWidth ?? 1,
      item.strokeDashOffset ?? 0,
      0,
      0,
      undefined,
      strokeEnds(item),
    );
    if (data) {
      enqueueOutline(
        { ...res.outline, ctx, device, bufferManager: res.bufferManager, uniformBuffer, clip },
        data,
        blendKey(item.blend),
        strokeGradient,
        bounds,
      );
    }
  }
}

export default {
  type: 'area',
  draw,
} satisfies MarkModule;
