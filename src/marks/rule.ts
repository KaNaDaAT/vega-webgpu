import type { Bounds } from 'vega-scenegraph';
import type { GPUVegaCanvasContext, GPUVegaScene } from '../types/context.js';
import type { SceneItem, SceneRule } from '../types/scene.js';
import { quadVertex } from '../util/arrays.js';
import { BufferManager } from '../util/bufferManager.js';
import { Color } from '../util/color.js';
import { VertexBufferManager } from '../util/vertexManager.js';
import { createUniformBindGroup } from '../util/webgpu.js';
import { SEGMENT_LAYOUT, getMarkResources, markClip, markPipeline, segmentInstance, type MarkModule } from './util.js';

const drawName = 'Rule';

interface RuleResources {
  device: GPUDevice;
  bufferManager: BufferManager;
  vertexManager: VertexBufferManager;
  pipeline: GPURenderPipeline;
  diagonalPipeline: GPURenderPipeline;
  geometryBuffer: GPUBuffer;
}

function getResources(device: GPUDevice, ctx: GPUVegaCanvasContext, vb: Bounds): RuleResources {
  return getMarkResources(ctx, 'rule', device, vb, () => {
    const bufferManager = new BufferManager(device, drawName, ctx._uniforms.resolution, [vb.x1, vb.y1]);
    const vertexManager = new VertexBufferManager(
      ['float32x2'], // position
      // center, scale, color, half-thickness offset
      ['float32x2', 'float32x2', 'float32x4', 'float32x2'],
    );
    const pipeline = markPipeline(ctx, device, drawName, drawName, vertexManager);
    // A rule with both x2 and y2 set is a diagonal segment, which an
    // axis-aligned quad cannot express. Those go through the single-segment
    // line shader instead.
    const diagonalVertexManager = new VertexBufferManager([], SEGMENT_LAYOUT);
    const diagonalPipeline = markPipeline(ctx, device, `${drawName}Diagonal`, 'SLine', diagonalVertexManager);
    const geometryBuffer = bufferManager.createGeometryBuffer(quadVertex);
    return { device, bufferManager, vertexManager, pipeline, diagonalPipeline, geometryBuffer };
  });
}

/** True when the rule runs at an angle, so it cannot be drawn as a rect. */
function isDiagonal(item: SceneRule): boolean {
  const x = item.x || 0;
  const y = item.y || 0;
  return (item.x2 ?? x) !== x && (item.y2 ?? y) !== y;
}

function draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, vb: Bounds): void {
  const items = scene.items as SceneRule[];
  if (!items?.length) {
    return;
  }

  const res = getResources(device, ctx, vb);

  const uniformBuffer = res.bufferManager.createUniformBuffer();
  const uniformBindGroup = createUniformBindGroup(drawName, device, res.pipeline, uniformBuffer);
  const clip = markClip(ctx, scene);

  let run: SceneRule[] = [];
  const flushRun = () => {
    if (run.length === 0) {
      return;
    }
    const instanceBuffer = res.bufferManager.createInstanceBuffer(createAttributes(run));
    ctx._renderQueue.enqueue({
      pipeline: res.pipeline,
      drawCounts: [6, run.length],
      vertexBuffers: [res.geometryBuffer, instanceBuffer],
      bindGroups: [uniformBindGroup],
      clip,
    });
    run = [];
  };

  for (const item of items) {
    if (!isDiagonal(item)) {
      run.push(item);
      continue;
    }
    flushRun();
    const instanceBuffer = res.bufferManager.createInstanceBuffer(createDiagonalAttributes(item));
    ctx._renderQueue.enqueue({
      pipeline: res.diagonalPipeline,
      drawCounts: [6, 1],
      vertexBuffers: [instanceBuffer],
      bindGroups: [createUniformBindGroup(`${drawName}Diagonal`, device, res.diagonalPipeline, uniformBuffer)],
      clip,
    });
  }
  flushRun();
}

function createAttributes(items: SceneItem[]): Float32Array {
  return Float32Array.from(
    items.flatMap(item => {
      const { x = 0, y = 0, x2, y2, stroke, strokeWidth = 1, opacity = 1, strokeOpacity = 1 } = item as SceneRule;
      const ex = x2 ?? x;
      const ey = y2 ?? y;
      const ax = Math.abs(ex - x);
      const ay = Math.abs(ey - y);
      const col = Color.from(stroke, opacity, strokeOpacity);
      const w = ax ? ax : strokeWidth;
      const h = ay ? ay : strokeWidth;
      const offX = ax ? 0 : strokeWidth / 2;
      const offY = ay ? 0 : strokeWidth / 2;
      return [Math.min(x, ex), Math.min(y, ey), w, h, ...col.rgba, offX, offY];
    }),
  );
}

function createDiagonalAttributes(item: SceneRule): Float32Array {
  const { x = 0, y = 0, x2, y2, stroke, strokeWidth = 1, opacity = 1, strokeOpacity = 1 } = item;
  const col = Color.from2(stroke, opacity, strokeOpacity);
  return segmentInstance(x, y, x2 ?? x, y2 ?? y, col, strokeWidth);
}

export default {
  type: 'rule',
  draw,
} satisfies MarkModule;
