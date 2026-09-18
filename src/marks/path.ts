import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { ScenePathItem } from '../types/scene.js';
import geometryForItem from '../path/geometryForItem.js';
import geometryForPath, { DASH_FLATNESS } from '../path/geometryForPath.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import {
  GeometryBatch,
  cachedGeometryData,
  dashPatternOf,
  strokeAsSegments,
  strokeOutline,
  enqueueOutline,
  type GeometryCache,
  geometryVertexData,
  getMarkResources,
  gradientTargetOf,
  enqueueGradient,
  markClip,
  fillResources,
  type FillResources,
  strokeEnds,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Path';

interface PathResources extends FillResources {
  cache: GeometryCache;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): PathResources {
  return getMarkResources(ctx, 'path', device, vb, () => ({
    ...fillResources(ctx, device, vb, drawName),
    cache: new Map(),
  }));
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as ScenePathItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const clip = markClip(ctx, scene);
  const vertexLength = res.vertexManager.getVertexLength();
  const gradientTarget = gradientTargetOf(ctx, device, `${drawName}Gradient`, res, uniformBuffer, clip);

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
    // path items carry their own translation, rotation and scale
    const transform = {
      angle: ((item.angle || 0) * Math.PI) / 180,
      scaleX: item.scaleX ?? 1,
      scaleY: item.scaleY ?? 1,
    };
    const strokeItem = outlined ? { ...item, stroke: undefined } : item;
    const [fillData, strokeData] = cachedGeometryData(res.cache, strokeItem, fill, stroke, () => {
      const shapeGeom = geometryForPath(ctx, item.path);
      const geometry = geometryForItem(ctx, strokeItem, shapeGeom, false, item.x || 0, item.y || 0, transform);
      return geometryVertexData(geometry, fill, stroke);
    });
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

    // After the fill, which is the order canvas paints them in. Enqueued ahead
    // of it the fill covers the inner half of every dash.
    if (outlined && item.stroke) {
      const data = strokeOutline(
        geometryForPath(ctx, item.path, undefined, dash ? DASH_FLATNESS : undefined).lines,
        dash,
        stroke,
        item.strokeWidth ?? 1,
        item.strokeDashOffset ?? 0,
        item.x || 0,
        item.y || 0,
        transform,
        strokeEnds(item),
      );
      if (data) {
        flushBatch();
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
  flushBatch();
}

export default {
  type: 'path',
  draw,
} satisfies MarkModule;
