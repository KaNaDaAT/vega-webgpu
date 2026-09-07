import type { GPUVegaCanvasContext } from '../types/context.js';
import type { ShaderBuilder } from './common.js';
import { curveShader } from './curve.js';
import { gradientFillShader } from './gradientFill.js';
import { imageShader } from './image.js';
import { lineShader } from './line.js';
import { rectShader } from './rect.js';
import { ruleShader } from './rule.js';
import { slineShader } from './sline.js';
import { solidFillShader } from './solidFill.js';
import { symbolShader } from './symbol.js';
import { symbolSdfShader } from './symbolSdf.js';
import { symbolShapeShader } from './symbolShape.js';
import { textShader } from './text.js';

/**
 * Every shader source, by the name marks ask for. Area, path and shape all draw
 * triangulated geometry with a colour per vertex, and group backgrounds are
 * rounded rects, so those share a builder.
 */
const BUILDERS: Record<string, ShaderBuilder> = {
  Area: solidFillShader,
  Curve: curveShader,
  GradientFill: gradientFillShader,
  Group: rectShader,
  Image: imageShader,
  Line: lineShader,
  Path: solidFillShader,
  Rect: rectShader,
  Rule: ruleShader,
  Shape: solidFillShader,
  SLine: slineShader,
  Symbol: symbolShader,
  SymbolSdf: symbolSdfShader,
  SymbolShape: symbolShapeShader,
  Text: textShader,
};

/** Shader key for one analytic symbol shape. */
export function symbolSdfKey(shape: string): string {
  return `SymbolSdf:${shape}`;
}

/**
 * The compiled module for one shader variant, built on first use and cached on
 * the context for the life of the device. `key` names a builder, optionally
 * followed by a sub-variant after a colon.
 *
 * Building on demand rather than up front matters: a chart uses a handful of
 * these, and compiling every blend mode of every shader would put the cost of
 * shaders nobody draws into the first frame.
 */
export function shaderModule(
  ctx: GPUVegaCanvasContext,
  device: GPUDevice,
  key: string,
  blend: string,
): GPUShaderModule {
  const cacheKey = `${key}|${blend}`;
  const cached = ctx._shaderCache[cacheKey];
  if (cached) {
    return cached;
  }
  const sep = key.indexOf(':');
  const name = sep < 0 ? key : key.slice(0, sep);
  const build = BUILDERS[name];
  if (!build) {
    throw new Error(`[vega-webgpu] No shader named '${name}'.`);
  }
  const shader = device.createShaderModule({
    code: build(blend, sep < 0 ? undefined : key.slice(sep + 1)),
    label: `${cacheKey} Shader`,
  });
  ctx._shaderCache[cacheKey] = shader;
  return shader;
}
