import { color as parseColor } from 'd3-color';
import type { GPUVegaCanvasContext } from '../types/context.js';
import type { SceneGradient } from '../types/scene.js';
import { getMarkResources } from '../marks/util.js';

/** Texels in a baked gradient stop ramp. */
const RAMP_SIZE = 256;

export interface GradientResources {
  device: GPUDevice;
  sampler: GPUSampler;
  /** Stop ramps keyed by gradient id (or serialized stops). */
  ramps: Map<string, GPUTexture>;
}

export function getGradientResources(device: GPUDevice, ctx: GPUVegaCanvasContext): GradientResources {
  return getMarkResources(ctx, '__gradient', device, () => ({
    device,
    sampler: device.createSampler({
      label: 'Gradient Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    }),
    ramps: new Map(),
  }));
}

function rampKey(gradient: SceneGradient): string {
  return gradient.id ?? `${gradient.gradient}:${JSON.stringify(gradient.stops ?? [])}`;
}

/** Bakes the gradient's color stops into a RAMP_SIZE x 1 texture. */
export function getStopRamp(res: GradientResources, gradient: SceneGradient): GPUTexture {
  const key = rampKey(gradient);
  const cached = res.ramps.get(key);
  if (cached) {
    return cached;
  }

  const stops = (gradient.stops ?? [])
    .map(s => {
      const c = parseColor(s.color)?.rgb();
      return {
        offset: Math.min(Math.max(s.offset, 0), 1),
        r: c ? c.r : 0,
        g: c ? c.g : 0,
        b: c ? c.b : 0,
        a: c ? c.opacity : 1,
      };
    })
    .sort((a, b) => a.offset - b.offset);
  if (stops.length === 0) {
    stops.push({ offset: 0, r: 0, g: 0, b: 0, a: 1 });
  }

  const data = new Uint8Array(RAMP_SIZE * 4);
  for (let i = 0; i < RAMP_SIZE; i++) {
    const t = i / (RAMP_SIZE - 1);
    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s].offset && t <= stops[s + 1].offset) {
        lo = stops[s];
        hi = stops[s + 1];
        break;
      }
    }
    const span = hi.offset - lo.offset;
    const f = span > 0 ? Math.min(Math.max((t - lo.offset) / span, 0), 1) : 0;
    data[i * 4] = Math.round(lo.r + (hi.r - lo.r) * f);
    data[i * 4 + 1] = Math.round(lo.g + (hi.g - lo.g) * f);
    data[i * 4 + 2] = Math.round(lo.b + (hi.b - lo.b) * f);
    data[i * 4 + 3] = Math.round((lo.a + (hi.a - lo.a) * f) * 255);
  }

  const texture = res.device.createTexture({
    label: 'Gradient Stop Ramp',
    size: [RAMP_SIZE, 1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  res.device.queue.writeTexture({ texture }, data, { bytesPerRow: RAMP_SIZE * 4 }, [RAMP_SIZE, 1, 1]);

  res.ramps.set(key, texture);
  return texture;
}

/**
 * Gradient parameters as consumed by the gradient shaders:
 * coords = [x1, y1, x2, y2], bounds = [x, y, w, h] mapping positions into
 * the normalized gradient space, misc = [kind, r1, r2, 0].
 * Radial gradients use the concentric-circle approximation around (x2, y2).
 */
export function gradientParams(
  gradient: SceneGradient,
  bounds: [x: number, y: number, w: number, h: number],
): Float32Array<ArrayBuffer> {
  const radial = gradient.gradient === 'radial';
  const x1 = gradient.x1 ?? (radial ? 0.5 : 0);
  const y1 = gradient.y1 ?? (radial ? 0.5 : 0);
  const x2 = gradient.x2 ?? (radial ? 0.5 : 1);
  const y2 = gradient.y2 ?? (radial ? 0.5 : 0);
  const r1 = gradient.r1 ?? 0;
  const r2 = gradient.r2 ?? 0.5;
  return Float32Array.from([x1, y1, x2, y2, ...bounds, radial ? 2 : 1, r1, r2, 0]);
}

/** Creates the per-draw gradient bind group (params + ramp + sampler). */
export function createGradientBindGroup(
  res: GradientResources,
  pipeline: GPURenderPipeline,
  gradient: SceneGradient,
  bounds: [x: number, y: number, w: number, h: number],
): GPUBindGroup {
  const paramsBuffer = res.device.createBuffer({
    label: 'Gradient Params',
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  res.device.queue.writeBuffer(paramsBuffer, 0, gradientParams(gradient, bounds));

  return res.device.createBindGroup({
    label: 'Gradient Bind Group',
    layout: pipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: res.sampler },
      { binding: 1, resource: getStopRamp(res, gradient).createView() },
      { binding: 2, resource: { buffer: paramsBuffer } },
    ],
  });
}
