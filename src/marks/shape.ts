import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneShapeItem } from '../types/scene.js';
import { shape } from '../path/shapes.js';
import geometryForItem from '../path/geometryForItem.js';
import { BufferManager } from '../util/bufferManager.js';
import { Color, isGradient, type RGBA } from '../util/color.js';
import { createGradientBindGroup, getGradientResources } from '../util/gradient.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createRenderPipeline, createUniformBindGroup, preferredColorFormat } from '../util/webgpu.js';
import {
  GeometryBatch,
  geometryVertexData,
  getMarkResources,
  gradientBounds,
  markClip,
  whiteCarrier,
  type MarkModule,
} from './util.js';

const drawName = 'Shape';

interface ShapeCacheEntry {
  fill: RGBA;
  stroke: RGBA;
  x?: number;
  y?: number;
  bounds?: Bounds;
  strokeWidth?: number;
  data: [Float32Array, Float32Array];
}

interface ShapeResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  gradientPipeline: GPURenderPipeline;
  cache: Map<unknown, ShapeCacheEntry>;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): ShapeResources {
  return getMarkResources(ctx, 'shape', device, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x3', 'float32x4'], // position, color
      [],
    );
    const pipeline = createRenderPipeline(
      drawName,
      device,
      ctx._shaderCache[drawName],
      preferredColorFormat(),
      ctx._sampleCount,
      vertexManager.getBuffers(),
    );
    const gradientPipeline = createRenderPipeline(
      `${drawName}Gradient`,
      device,
      ctx._shaderCache['GradientFill'],
      preferredColorFormat(),
      ctx._sampleCount,
      vertexManager.getBuffers(),
    );
    return { device, bufferManager, vertexManager, pipeline, gradientPipeline, cache: new Map() };
  });
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as SceneShapeItem[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);
  res.bufferManager.setResolution(ctx._uniforms.resolution);
  res.bufferManager.setOffset([vb.x1, vb.y1]);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const useCache = ctx._renderer.wgOptions.cacheShapes ?? false;
  const clip = markClip(ctx, scene);
  const vertexLength = res.vertexManager.getVertexLength();

  // Solid fills and strokes share one pipeline and are accumulated in paint
  // order into a single buffer/draw. Gradient fills interrupt the batch.
  const batch = new GeometryBatch();
  const flushBatch = () => {
    const data = batch.flush();
    if (data) {
      ctx._renderQueue.enqueue({
        pipeline: res.pipeline,
        drawCounts: [data.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(data)],
        bindGroups: [createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer)],
        clip,
      });
    }
  };

  for (const item of items) {
    const bounds = item.bounds;
    const gradient = isGradient(item.fill) && bounds ? item.fill : null;
    const [fillData, strokeData] = createGeometryData(ctx, res, item, gradient !== null, useCache);

    if (fillData.length > 0 && gradient && bounds) {
      flushBatch();
      const gres = getGradientResources(device, ctx);
      ctx._renderQueue.enqueue({
        pipeline: res.gradientPipeline,
        drawCounts: [fillData.length / vertexLength],
        vertexBuffers: [res.bufferManager.createGeometryBuffer(fillData)],
        bindGroups: [
          createUniformBindGroup(`${drawName}Gradient`, device, res.gradientPipeline, uniformBuffer),
          createGradientBindGroup(gres, res.gradientPipeline, gradient, gradientBounds(ctx, bounds)),
        ],
        clip,
      });
    } else {
      batch.push(fillData);
    }
    batch.push(strokeData);
  }
  flushBatch();
}

function cacheKey(item: SceneShapeItem): unknown {
  if (item.datum?.id != null) {
    return item.datum.id;
  }
  if (item.id != null) {
    return item.id;
  }
  // vega tuple ids are stored under a symbol property
  const symbols = Object.getOwnPropertySymbols(item);
  return symbols.length > 0 ? (item as unknown as Record<symbol, unknown>)[symbols[0]] : item;
}

function sameColor(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function recolor(data: Float32Array, source: Float32Array, color: RGBA): void {
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

function createGeometryData(
  ctx: GPUVegaCanvasContext,
  res: ShapeResources,
  item: SceneShapeItem,
  hasGradient: boolean,
  useCache: boolean,
): [fillData: Float32Array, strokeData: Float32Array] {
  const key = cacheKey(item);
  const fill = hasGradient
    ? whiteCarrier(item.opacity, item.fillOpacity)
    : Color.from2(item.fill, item.opacity, item.fillOpacity);
  const stroke = Color.from2(item.stroke, item.opacity, item.strokeOpacity);

  if (useCache) {
    const entry = res.cache.get(key);
    if (
      entry &&
      item.strokeWidth === entry.strokeWidth &&
      item.x === entry.x &&
      item.y === entry.y &&
      item.bounds === entry.bounds
    ) {
      if (sameColor(entry.fill, fill) && sameColor(entry.stroke, stroke)) {
        return entry.data;
      }
      // geometry unchanged, rewrite only the colors
      const data: [Float32Array, Float32Array] = [
        new Float32Array(entry.data[0].length),
        new Float32Array(entry.data[1].length),
      ];
      recolor(data[0], entry.data[0], fill);
      recolor(data[1], entry.data[1], stroke);
      return data;
    }
  }

  const shapeGeom = shape(ctx, item);
  const geometry = geometryForItem(ctx, item, shapeGeom);
  const data = geometryVertexData(geometry, fill, stroke);

  if (useCache) {
    res.cache.set(key, {
      fill,
      stroke,
      x: item.x,
      y: item.y,
      bounds: item.bounds,
      strokeWidth: item.strokeWidth,
      data,
    });
  }
  return data;
}

export default {
  type: 'shape',
  draw,
} satisfies MarkModule;
