import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { PathGeometry } from '../types/geometry.js';
import type { SceneAreaItem } from '../types/scene.js';
import { DASH_FLATNESS } from '../path/geometryForPath.js';
import geometryForItem from '../path/geometryForItem.js';
import { blendKey } from '../util/blend.js';
import { Color, isGradient } from '../util/color.js';
import {
  dashPatternOf,
  enqueueGradient,
  enqueueMaskedOutline,
  enqueueOutline,
  outlineTargetOf,
  enqueueSolid,
  fillResources,
  geometryVertexData,
  getMarkResources,
  gradientTargetOf,
  markClip,
  solidTargetOf,
  strokeEnds,
  strokeOutline,
  strokeReach,
  whiteCarrier,
  type MarkModule,
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
    const bounds = scene.bounds ?? item.bounds;
    const gradient = isGradient(item.fill) && bounds ? item.fill : null;
    const fill = gradient
      ? whiteCarrier(item.opacity, item.fillOpacity)
      : Color.from(item.fill, item.opacity, item.fillOpacity);
    const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
    const stroke = strokeGradient
      ? whiteCarrier(item.opacity, item.strokeOpacity)
      : Color.from(item.stroke, item.opacity, item.strokeOpacity);

    // The stroke is walked as segments, so it is left off the geometry.
    const dash = dashPatternOf(item);
    const shapeGeom = shapeOf(ctx, items);
    const geometry = geometryForItem(ctx, { ...item, stroke: undefined }, shapeGeom, true);
    const [fillData] = geometryVertexData(geometry, fill, stroke);

    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const clip = markClip(ctx, scene);
    const gradientTarget = gradientTargetOf(ctx, device, `${name}Gradient`, res, uniformBuffer, clip);
    const solidTarget = solidTargetOf(ctx, device, name, res, uniformBuffer, clip);

    if (fillData.length > 0) {
      if (gradient && bounds) {
        enqueueGradient(gradientTarget, fillData, gradient, bounds, blendKey(item.blend));
      } else {
        enqueueSolid(solidTarget, fillData, blendKey(item.blend));
      }
    }

    // After the fill, which is the order canvas paints them in.
    if (item.stroke) {
      const data = strokeOutline(
        dash ? shapeOf(ctx, items, DASH_FLATNESS).lines : shapeGeom.lines,
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
        const outline = outlineTargetOf(ctx, device, res, uniformBuffer, clip);
        // A ramp cannot be read back out of a coverage mask, so a gradient
        // stroke goes band by band whatever the mark asked for.
        if (!maskOutline || (strokeGradient && bounds)) {
          enqueueOutline(outline, data, blendKey(item.blend), strokeGradient, bounds);
        } else {
          enqueueMaskedOutline(outline, data, blendKey(item.blend), stroke, strokeReach(item));
        }
      }
    }
  }

  return { type, draw } satisfies MarkModule;
}
