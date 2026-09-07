import symbolSdfShader from '../shaders/symbolSdf.wgsl';
import type { GPUVegaCanvasContext } from '../types/context.js';

/**
 * `circle` is absent because it already has a dedicated analytic shader and
 * routing it here measured neutral, 36/57 against 35/61 worst channel.
 *
 * `cross` is deliberately absent: it is a union of two boxes, and eroding that
 * union for the inner stroke edge is not the union of the eroded boxes, which
 * puts its reflex corners in the wrong place. It stays triangulated.
 *
 * Distance functions for the symbol shapes with a closed form, keyed by vega's
 * shape name. Each is the body of `shapeDistance(p, s)` in symbolSdf.wgsl,
 * where `s` is sqrt(size), the scale d3-symbol works in.
 *
 * The constants come straight from d3's own paths at size 100 (s = 10):
 * square `M-5,-5h10v10h-10Z`, diamond `M-5,0L0,-5L5,0L0,5Z`,
 * cross `M-5,-2...` and triangle-up `M0,-4.33L-5,4.33L5,4.33Z`.
 */
const SHAPE_SDF: Record<string, string> = {
  square: '    return sdBox(p, vec2<f32>(s * 0.5 + inflate, s * 0.5 + inflate));',
  // vertices sit at s/2 on each axis, and moving both edges out by `inflate`
  // raises the |x| + |y| threshold by inflate * sqrt(2)
  diamond: '    return (abs(p.x) + abs(p.y) - (s * 0.5 + inflate * 1.41421356)) * 0.70710678;',
  // every d3 triangle is equilateral, so its inradius is s / (2 * sqrt(3))
  'triangle-up': `    return sdTriangleInflated(p, vec2<f32>(0.0, -0.433 * s), vec2<f32>(-0.5 * s, 0.433 * s), vec2<f32>(0.5 * s, 0.433 * s), 0.28868 * s, inflate);`,
  'triangle-down': `    return sdTriangleInflated(p, vec2<f32>(0.0, 0.433 * s), vec2<f32>(0.5 * s, -0.433 * s), vec2<f32>(-0.5 * s, -0.433 * s), 0.28868 * s, inflate);`,
  'triangle-right': `    return sdTriangleInflated(p, vec2<f32>(0.433 * s, 0.0), vec2<f32>(-0.433 * s, 0.5 * s), vec2<f32>(-0.433 * s, -0.5 * s), 0.28868 * s, inflate);`,
  'triangle-left': `    return sdTriangleInflated(p, vec2<f32>(-0.433 * s, 0.0), vec2<f32>(0.433 * s, -0.5 * s), vec2<f32>(0.433 * s, 0.5 * s), 0.28868 * s, inflate);`,
  triangle: `    return sdTriangleInflated(p, vec2<f32>(0.0, -0.5774 * s), vec2<f32>(-0.5 * s, 0.2887 * s), vec2<f32>(0.5 * s, 0.2887 * s), 0.28868 * s, inflate);`,
};

/** True when the shape has a distance function and can skip triangulation. */
export function hasSdf(shape: string): boolean {
  return Object.hasOwn(SHAPE_SDF, shape);
}

/**
 * Compiles one shader per shape, on first use, into the context's shader cache.
 * Substituting the distance function keeps the fragment shader branchless,
 * where one shader switching on a shape id would branch per pixel.
 */
export function symbolSdfShaderKey(ctx: GPUVegaCanvasContext, device: GPUDevice, shape: string): string {
  const key = `SymbolSdf:${shape}`;
  if (!ctx._shaderCache[key]) {
    const body = SHAPE_SDF[shape];
    if (body === undefined) {
      throw new Error(`[vega-webgpu] No distance function for symbol shape '${shape}'.`);
    }
    ctx._shaderCache[key] = device.createShaderModule({
      code: symbolSdfShader.replace('//__SHAPE_SDF__', body),
      label: `Symbol SDF Shader (${shape})`,
    });
  }
  return key;
}
