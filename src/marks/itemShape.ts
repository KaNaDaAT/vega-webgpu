import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { PathGeometry } from '../types/geometry.js';
import type { ItemTransform } from '../path/geometryForItem.js';
import type { FillStyle, SceneItem, StrokeStyle } from '../types/scene.js';
import { DASH_FLATNESS } from '../path/geometryForPath.js';
import geometryForItem from '../path/geometryForItem.js';
import { blendKey } from '../util/blend.js';
import { DrawRun } from '../util/drawRun.js';
import { joinChunks } from '../util/geometryBatch.js';
import {
  cachedGeometryData,
  dashPatternOf,
  enqueueOutline,
  fillResources,
  vertexData,
  getMarkResources,
  markClip,
  markItems,
  strokeEnds,
  strokeOutline,
  type FillResources,
  type GeometryCache,
  type MarkModule,
  enqueueFill,
  paintOf,
  targetOf,
} from './util.js';

/** One item's shape, at the given curve flatness. */
type ShapeOf<T> = (ctx: GPUVegaCanvasContext, item: T, scale?: number) => PathGeometry;

interface ItemShapeMark<T> {
  type: string;
  /** Labels this mark's pipelines, buffers and bind groups. */
  name: string;
  shapeOf: ShapeOf<T>;
  /** The rotation and scale the item carries, for a mark whose items do. */
  transformOf?: (item: T) => ItemTransform;
  /**
   * Whether the triangulation is held between frames. Only for a mark whose
   * shape is settled by the fields `cachedGeometryData` compares: an arc is
   * drawn from angles and radii it does not look at, so a held one would
   * survive its own shape changing.
   */
  cached?: boolean;
}

interface Resources extends FillResources {
  cache: GeometryCache;
}

/**
 * arc and path: marks that triangulate one shape per item, fill it, and walk
 * its contours for the stroke.
 *
 * The two differ in where the shape comes from, whether the item carries a
 * transform of its own and whether the triangulation is worth holding. Paint
 * order, batching, the gradient routes and the outline are the same, and had
 * been written out twice.
 */
export function itemShapeMark<T extends SceneItem & FillStyle & StrokeStyle>({
  type,
  name,
  shapeOf,
  transformOf,
  cached,
}: ItemShapeMark<T>): MarkModule {
  function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
    const items = markItems<T>(scene);
    if (items.length === 0) {
      return;
    }

    const res = getMarkResources<Resources>(ctx, type, device, vb, () => ({
      ...fillResources(ctx, device, vb, name),
      cache: new Map(),
    }));
    const uniformBuffer = res.bufferManager.createUniformBuffer();
    const clip = markClip(ctx, scene);
    const fillTarget = targetOf(ctx, device, name, res, res.bufferManager, uniformBuffer, clip);
    const outlineTarget = targetOf(ctx, device, res.outline.name, res.outline, res.bufferManager, uniformBuffer, clip);

    // Solid fills share one draw in paint order, and a gradient fill or an
    // outline closes the run.
    const run = new DrawRun<Float32Array>(ctx._opaqueBackdrop, (chunks, blend) => {
      const data = joinChunks(chunks);
      if (data) {
        enqueueFill(fillTarget, data, null, blend);
      }
    });

    for (const item of items) {
      const blend = blendKey(item.blend);
      const fill = paintOf(item.fill, item.opacity, item.fillOpacity, item.bounds);
      const stroke = paintOf(item.stroke, item.opacity, item.strokeOpacity, item.bounds);

      const dash = dashPatternOf(item);
      const transform = transformOf?.(item);
      // Lazy, so a held fill never runs the generator, and shared, so the
      // stroke walks the contours the fill was built from.
      let held: PathGeometry | null = null;
      const shape = () => (held ??= shapeOf(ctx, item));

      // The stroke is walked as segments, so it is left off the geometry. The
      // shape is generated around the origin, so the item centre is baked in.
      const strokeItem = { ...item, stroke: undefined };
      const build = (): Float32Array => {
        const geometry = geometryForItem(ctx, strokeItem, shape(), false, item.x || 0, item.y || 0, transform);
        return vertexData(geometry.fillTriangles, geometry.fillCount, fill.colour);
      };
      const fillData = cached ? cachedGeometryData(res.cache, strokeItem, fill.colour, build) : build();

      if (fillData.length > 0 && fill.ramp) {
        run.flush();
        enqueueFill(fillTarget, fillData, fill.ramp, blend);
      } else {
        run.add(fillData, blend);
      }
      // After the fill, which is the order canvas paints them in. Enqueued
      // ahead of it the fill covers the inner half of every dash.
      if (item.stroke) {
        const data = strokeOutline(
          dash ? shapeOf(ctx, item, DASH_FLATNESS).lines : shape().lines,
          dash,
          stroke.colour,
          item.strokeWidth ?? 1,
          item.strokeDashOffset ?? 0,
          item.x || 0,
          item.y || 0,
          transform,
          strokeEnds(item),
        );
        if (data) {
          run.flush();
          enqueueOutline(outlineTarget, data, stroke.ramp, blend);
        }
      }
    }
    run.flush();
  }

  return { draw } satisfies MarkModule;
}
