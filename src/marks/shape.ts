import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { PathGeometry } from '../types/geometry.js';
import type { SceneShapeItem } from '../types/scene.js';
import { shape } from '../path/shapes.js';
import geometryForItem, { itemTurn } from '../path/geometryForItem.js';
import { blendKey, needsBackdrop } from '../util/blend.js';
import type { Point } from '../types/geometry.js';
import { dashPolyline } from '../util/dash.js';
import { Color, isGradient, type RGBA } from '../util/color.js';
import { GeometryBatch } from '../util/geometryBatch.js';
import {
  SEGMENT_STRIDE,
  segmentCount,
  segmentInstances,
  writeSegments,
  enqueueOutline,
  outlineTargetOf,
  vertexData,
  getMarkResources,
  gradientTargetOf,
  MAX_GEOMETRY_CACHE,
  solidTargetOf,
  enqueueGradient,
  enqueueSolid,
  markClip,
  markItems,
  copyBounds,
  recolor,
  sameBounds,
  sameColor,
  type BoundsSnapshot,
  fillResources,
  type FillResources,
  dashPatternOf,
  strokeEnds,
  whiteCarrier,
  type MarkModule,
  uniformBindGroup,
} from './util.js';

const drawName = 'Shape';

interface ShapeCacheEntry {
  fill: RGBA;
  stroke: RGBA;
  x?: number;
  y?: number;
  angle?: number;
  bounds?: BoundsSnapshot;
  strokeWidth?: number;
  strokeIsGradient: boolean;
  data: Float32Array;
  /** Contours the outline is built from, so a hit never re-runs the shape generator. */
  lines: Point[][];
  /** What the outline is cut and ended by, which the fill geometry says nothing about. */
  outline: string;
}

/**
 * Everything the stroke outline is built from beyond the contours and the
 * colour. The held buffer is only reused while this is unchanged, so a dash,
 * a cap or a join toggled on an existing item redraws: none of them moves a
 * vertex of the fill, and a cap or a join does not even change the segment
 * count the hold falls back on.
 */
function outlineSignature(item: SceneShapeItem): string {
  return [
    item.strokeDash?.join(' ') ?? '',
    item.strokeDashOffset ?? 0,
    item.strokeCap ?? '',
    item.strokeJoin ?? '',
    item.strokeMiterLimit ?? '',
  ].join('|');
}

interface ShapeResources extends FillResources {
  outlines: OutlineBuffer;
  /**
   * Per scene, because resources are shared by every mark of a type while the
   * render queue runs their draws at the end of the frame. One buffer between
   * them would leave every draw reading whichever mark wrote last.
   */
  outlineState: WeakMap<GPUVegaScene, OutlineState>;
  cache: Map<unknown, ShapeCacheEntry>;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): ShapeResources {
  return getMarkResources(ctx, 'shape', device, vb, () => ({
    ...fillResources(ctx, device, vb, drawName, `${drawName}Stroke`),
    outlines: new OutlineBuffer(),
    outlineState: new WeakMap(),
    cache: new Map(),
  }));
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = markItems<SceneShapeItem>(scene);
  if (items.length === 0) {
    return;
  }

  const res = getResources(device, ctx, vb);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const useCache = ctx._renderer.wgOptions.cacheShapes ?? true;
  const clip = markClip(ctx, scene);
  const gradientTarget = gradientTargetOf(ctx, device, `${drawName}Gradient`, res, uniformBuffer, clip);
  const solidTarget = solidTargetOf(ctx, device, drawName, res, uniformBuffer, clip);

  // Solid fills and strokes share one pipeline and are accumulated in paint
  // order into a single buffer/draw. Gradient fills interrupt the batch.
  const batch = new GeometryBatch();
  // one batch draws with one pipeline, so a change of blend closes it
  let batchBlend = 'normal';
  // Outlines accumulate separately and draw after the fills. A sub pixel
  // stroke on a triangulated ribbon takes its coverage from MSAA, which can
  // only express quarter steps, so a 0.2 px country border came out patchy.
  const outlines = res.outlines;
  outlines.length = 0;
  // An outline only has to be rebuilt when something it is drawn from moved or
  // changed colour, which on a stroked choropleth is the difference between
  // rewriting a few hundred thousand segments a frame and rewriting none.
  let outlinesHeld = true;
  // Which stretch of the shared outline buffer carries which blend, so one
  // buffer can still serve a mark whose items do not agree on it.
  const outlineRuns: { blend: string; start: number; count: number }[] = [];
  const flushBatch = () => {
    const data = batch.flush();
    if (data) {
      enqueueSolid(solidTarget, data, batchBlend);
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
    const strokeGradient = isGradient(item.stroke) && bounds ? item.stroke : null;
    let shapeGeom: PathGeometry | null = null;
    const geom = () => (shapeGeom ??= shape(ctx, item));
    const [fillData, lines, unchanged] = createGeometryData(
      ctx,
      res,
      item,
      gradient !== null,
      strokeGradient !== null,
      useCache,
      geom,
    );

    if (fillData.length > 0 && gradient && bounds) {
      flushBatch();
      enqueueGradient(gradientTarget, fillData, gradient, bounds, blend);
    } else {
      batch.push(fillData);
    }
    // One draw per item, see needsBackdrop.
    const layered = needsBackdrop(blend, ctx._opaqueBackdrop);
    if ((strokeGradient && bounds) || layered) {
      // A ramp is per item, so this one cannot join the held buffer below: its
      // own draw carries its own bind group. Neither can a layered blend, since
      // the held buffer draws after every fill where canvas strokes each item
      // before it fills the next.
      const color = strokeGradient
        ? whiteCarrier(item.opacity, item.strokeOpacity)
        : Color.from(item.stroke, item.opacity, item.strokeOpacity);
      const own = color[3] > 0 ? outlineInstances(item, lines, color) : null;
      if (own) {
        flushBatch();
        enqueueOutline(
          outlineTargetOf(ctx, device, res, uniformBuffer, clip),
          own,
          blend,
          strokeGradient && bounds ? strokeGradient : null,
          bounds,
        );
      }
    } else {
      outlinesHeld &&= unchanged;
      const before = outlines.length / SEGMENT_STRIDE;
      pushOutline(outlines, item, lines);
      const after = outlines.length / SEGMENT_STRIDE;
      const last = outlineRuns[outlineRuns.length - 1];
      if (last && last.blend === blend) {
        last.count = after - last.start;
      } else if (after > before) {
        outlineRuns.push({ blend, start: before, count: after - before });
      }
    }
    if (layered) {
      flushBatch();
    }
  }
  flushBatch();

  const state = res.outlineState.get(scene) ?? { buffer: null, capacity: 0, length: -1 };
  res.outlineState.set(scene, state);
  const heldOutline = outlinesHeld && outlines.length === state.length && state.buffer !== null;
  state.length = outlines.length;

  if (outlines.length > 0) {
    const buffer = outlineBuffer(device, state, outlines, heldOutline);
    for (const run of outlineRuns) {
      const pipeline = res.outline.pipelineFor(run.blend);
      ctx._renderQueue.enqueue({
        pipeline,
        drawCounts: [6, run.count, 0, run.start],
        vertexBuffers: [buffer],
        bindGroups: [uniformBindGroup(ctx, device, `${drawName}Stroke`, pipeline, uniformBuffer)],
        clip,
      });
    }
  }
}

/**
 * Appends one item's outline, contour by contour, as segment instances. A dash
 * splits each contour into its drawn runs first, which is the only way a shape
 * can carry one: its stroke is an extruded ribbon everywhere else.
 */
function pushOutline(out: OutlineBuffer, item: SceneShapeItem, lines: Point[][]): void {
  const width = item.strokeWidth ?? 1;
  const color = Color.from(item.stroke, item.opacity, item.strokeOpacity);
  const runs = outlineRuns(item, lines);
  if (!runs || color[3] <= 0) {
    return;
  }
  const needed = segmentCount(runs) * SEGMENT_STRIDE;
  const { caps, join, square } = strokeEnds(item);
  out.length = writeSegments(out.reserve(needed), out.length, runs, color, width, caps, join, square);
}

/**
 * Contours placed the way the fill is. vega translates to the item and rotates
 * before it calls the generator and strokes the path it filled, so an outline
 * walked off the raw contours was drawn at the origin whatever the item's x, y
 * and angle said.
 *
 * Returned untouched where there is nothing to apply, which is every geo
 * shape, so a choropleth allocates nothing here.
 */
function placeLines(item: SceneShapeItem, lines: Point[][]): Point[][] {
  const dx = item.x || 0;
  const dy = item.y || 0;
  const angle = itemTurn(item);
  if (dx === 0 && dy === 0 && angle === 0) {
    return lines;
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return lines.map(line => line.map(([x, y]): Point => [x * cos - y * sin + dx, x * sin + y * cos + dy]));
}

/** The drawn runs of one item's outline, or null when it has none. */
function outlineRuns(item: SceneShapeItem, lines: Point[][]): Point[][] | null {
  if (!item.stroke || (item.strokeWidth ?? 1) <= 0) {
    return null;
  }
  const placed = placeLines(item, lines);
  const pattern = dashPatternOf(item);
  const runs = pattern
    ? placed.flatMap(line => dashPolyline(line, pattern, item.strokeDashOffset ?? 0, strokeEnds(item).bridge))
    : placed;
  return segmentCount(runs) === 0 ? null : runs;
}

/** The same runs as their own instance buffer, for an outline drawn on its own. */
function outlineInstances(item: SceneShapeItem, lines: Point[][], color: RGBA): Float32Array | null {
  const runs = outlineRuns(item, lines);
  if (!runs) {
    return null;
  }
  const { caps, join, square } = strokeEnds(item);
  return segmentInstances(runs, color, item.strokeWidth ?? 1, caps, join, square);
}

interface OutlineState {
  buffer: GPUBuffer | null;
  capacity: number;
  length: number;
}

/**
 * The scene's own outline buffer, rewritten only when the outline changed.
 * writeBuffer is ordered on the queue, so a rewrite lands after the previous
 * frame's draws have read it.
 */
function outlineBuffer(device: GPUDevice, state: OutlineState, outlines: OutlineBuffer, held: boolean): GPUBuffer {
  const bytes = new Uint8Array(outlines.data.buffer, 0, outlines.length * 4);
  if (state.buffer && held) {
    return state.buffer;
  }
  if (!state.buffer || state.capacity < bytes.byteLength) {
    let capacity = Math.max(bytes.byteLength, 4096);
    if (state.buffer) {
      capacity = Math.max(capacity, state.capacity * 2);
    }
    state.buffer = device.createBuffer({
      label: `${drawName} Outline`,
      size: capacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    state.capacity = capacity;
  }
  device.queue.writeBuffer(state.buffer, 0, bytes, 0, bytes.byteLength);
  return state.buffer;
}

/**
 * A float buffer the shape mark keeps between frames. Outlines run to hundreds
 * of thousands of segments on a stroked choropleth, so growing a plain array a
 * number at a time and converting it back cost more than everything else the
 * mark does.
 */
class OutlineBuffer {
  data = new Float32Array(0);
  length = 0;

  /** Room for `n` more floats, returning the buffer to write into. */
  reserve(n: number): Float32Array {
    if (this.length + n > this.data.length) {
      let size = Math.max(4096, this.data.length * 2);
      while (size < this.length + n) {
        size *= 2;
      }
      const grown = new Float32Array(size);
      grown.set(this.data.subarray(0, this.length));
      this.data = grown;
    }
    return this.data;
  }
}

/**
 * The item itself, which vega keeps across re-renders of the same tuple. A
 * datum id is not unique: a county split across several polygons is several
 * items sharing one id, and they would then share one entry.
 */
function cacheKey(item: SceneShapeItem): unknown {
  return item;
}

function createGeometryData(
  ctx: GPUVegaCanvasContext,
  res: ShapeResources,
  item: SceneShapeItem,
  hasGradient: boolean,
  strokeIsGradient: boolean,
  useCache: boolean,
  geom: () => PathGeometry,
): [fillData: Float32Array, lines: Point[][], unchanged: boolean] {
  const key = cacheKey(item);
  const fill = hasGradient
    ? whiteCarrier(item.opacity, item.fillOpacity)
    : Color.from(item.fill, item.opacity, item.fillOpacity);
  const stroke = strokeIsGradient
    ? whiteCarrier(item.opacity, item.strokeOpacity)
    : Color.from(item.stroke, item.opacity, item.strokeOpacity);

  const outline = outlineSignature(item);
  if (useCache) {
    const entry = res.cache.get(key);
    if (
      entry &&
      strokeIsGradient === entry.strokeIsGradient &&
      item.strokeWidth === entry.strokeWidth &&
      item.x === entry.x &&
      item.y === entry.y &&
      item.angle === entry.angle &&
      sameBounds(item.bounds, entry.bounds)
    ) {
      // re-insert to keep the map in least-recently-used order
      res.cache.delete(key);
      res.cache.set(key, entry);
      const heldOutline = outline === entry.outline;
      entry.outline = outline;
      if (sameColor(entry.fill, fill) && sameColor(entry.stroke, stroke)) {
        return [entry.data, entry.lines, heldOutline];
      }
      // geometry unchanged, rewrite only the colors
      const data = new Float32Array(entry.data.length);
      recolor(data, entry.data, fill);
      return [data, entry.lines, false];
    }
  }

  // the outline draws as segments, so the triangulation only builds the fill
  const shapeGeom = geom();
  // vega translates to the item and rotates before it calls the generator, so
  // a shape given an x, y or angle is drawn there rather than at the origin
  const geometry = geometryForItem(ctx, { ...item, stroke: undefined }, shapeGeom, false, item.x || 0, item.y || 0, {
    angle: itemTurn(item),
    scaleX: 1,
    scaleY: 1,
  });
  const data = vertexData(geometry.fillTriangles, geometry.fillCount, fill);

  if (useCache) {
    if (res.cache.size >= MAX_GEOMETRY_CACHE) {
      const oldest = res.cache.keys().next().value;
      if (oldest !== undefined) {
        res.cache.delete(oldest);
      }
    }
    res.cache.set(key, {
      fill,
      stroke,
      x: item.x,
      y: item.y,
      angle: item.angle,
      bounds: copyBounds(item.bounds),
      strokeWidth: item.strokeWidth,
      strokeIsGradient,
      data,
      lines: shapeGeom.lines,
      outline,
    });
  }
  return [data, shapeGeom.lines, false];
}

export default { draw } satisfies MarkModule;
