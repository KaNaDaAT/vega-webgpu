import type { GPUVegaCanvasContext } from '../types/context.js';

/**
 * Sizes the WebGPU canvas to the view and mirrors the coordinate transform
 * onto the detached pick canvas so geometric hit-testing (isPointInPath)
 * matches what is rendered.
 */
export default function resize(
  canvas: HTMLCanvasElement,
  context: GPUVegaCanvasContext,
  width: number,
  height: number,
  origin: readonly [number, number],
  pickCanvas: HTMLCanvasElement,
  pickContext: CanvasRenderingContext2D,
  scaleFactor?: number,
): HTMLCanvasElement {
  const inDOM = typeof HTMLElement !== 'undefined' && canvas instanceof HTMLElement && canvas.parentNode != null;
  const ratio = scaleFactor ?? (inDOM ? window.devicePixelRatio || 1 : 1);

  canvas.width = width * ratio;
  canvas.height = height * ratio;

  pickCanvas.width = width * ratio;
  pickCanvas.height = height * ratio;
  // vega's canvas picking reads pixelRatio off the context and tests paths
  // in the same transformed space the marks are drawn in.
  (pickContext as CanvasRenderingContext2D & { pixelRatio: number }).pixelRatio = ratio;
  pickContext.setTransform(ratio, 0, 0, ratio, ratio * origin[0], ratio * origin[1]);

  if (ratio !== 1) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  context._origin = origin;
  context._ratio = ratio;
  context._clip = undefined;

  return canvas;
}
