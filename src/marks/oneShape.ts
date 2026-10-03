import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { PathGeometry } from '../types/geometry.js';
import type { SceneAreaItem } from '../types/scene.js';
import { DASH_FLATNESS } from '../path/geometryForPath.js';
import geometryForItem from '../path/geometryForItem.js';
import { blendKey } from '../util/blend.js';
import {
  dashPatternOf,
  enqueueMaskedOutline,
  enqueueOutline,
  fillResources,
  vertexData,
  getMarkResources,
  markClip,
  strokeEnds,
  strokeOutline,
  strokeReach,
  type MarkModule,
  enqueueFill,
  paintOf,
  targetOf,
} from './util.js';

/** The whole mark's shape, built from every one of its items. */
type ShapeOf = (ctx: GPUVegaCanvasContext, items: SceneAreaItem[], scale?: number) => PathGeometry;

interface OneShapeMark {
  type: string;
  /** Labels this mark's pipelines, buffers and bind groups. */
  name: string;
  shapeOf: ShapeOf;
  /**
   * Whether the stroke is resolved through a coverage mask before it is
   * composited. vega writes one closed contour per trail segment and
   * consecutive contours overlap, so two antialiased fringes land on the same
   * pixel where canvas fills the union of the bands once. An area is a single
   * contour and needs no such pass.
   */
  maskOutline: boolean;
}

/**
 * area and trail are the two marks whose items are one shape rather than one
 * each: the mark carries a single set of styles, the fill is one
 * triangulation, and the stroke is one walk of its contours.
 */
export function oneShapeMark({ type, name, shapeOf, maskOutline }: OneShapeMark): MarkModule {
  function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
    const items = scene.items as SceneAreaItem[];
    if (!items?.length) {
      return;
    }

    const res = getMarkResources(ctx, type, device, vb, () => fillResources(ctx, device, vb, name));

    const item = items[0];
    const blend = blendKey(item.blend);
    const bounds = scene.bounds ?? item.bounds;
    const fill = paintOf(item.fill, item.opacity, item.fillOpacity, bounds);
    const stroke = paintOf(item.stroke, item.opacity, item.strokeOpacity, bounds);

    // The stroke is walked as segments, so it is left off the geometry.
    const dash = dashPatternOf(item);
    const shapeGeom = shapeOf(ctx, items);
    const geometry = geometryForItem(ctx, { ...item, stroke: undefined }, shapeGeom, true);
    const fillData = vertexData(geometry.fillTriangles, geometry.fillCount, fill.colour);

    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const clip = markClip(ctx, scene);
    const fillTarget = targetOf(ctx, device, name, res, res.bufferManager, uniformBuffer, clip);

    if (fillData.length > 0) {
      enqueueFill(fillTarget, fillData, fill.ramp, blend);
    }

    // After the fill, which is the order canvas paints them in.
    if (item.stroke) {
      const data = strokeOutline(
        dash ? shapeOf(ctx, items, DASH_FLATNESS).lines : shapeGeom.lines,
        dash,
        stroke.colour,
        item.strokeWidth ?? 1,
        item.strokeDashOffset ?? 0,
        0,
        0,
        undefined,
        strokeEnds(item),
      );
      if (data) {
        const outline = targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, uniformBuffer, clip);
        // A ramp cannot be read back out of a coverage mask, so a gradient
        // stroke goes band by band whatever the mark asked for.
        if (!maskOutline || stroke.ramp) {
          enqueueOutline(outline, data, stroke.ramp, blend);
        } else {
          enqueueMaskedOutline(outline, data, blend, stroke.colour, strokeReach(item));
        }
      }
    }
  }

  return { draw } satisfies MarkModule;
}
