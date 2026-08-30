import { CanvasHandler, CanvasRenderer, renderModule } from 'vega-scenegraph';
import WebGPURenderer from './src/WebGPURenderer.js';

const webgpuSupported = typeof navigator !== 'undefined' && !!navigator.gpu;

if (webgpuSupported) {
  // The WebGPU canvas cannot hand out a 2D context for picking; route the
  // handler to the renderer's detached pick canvas instead.
  CanvasHandler.prototype.context = function (this: CanvasHandler) {
    return this._canvas.getContext('2d') || (this._canvas._pickCanvas?.getContext('2d') ?? null);
  };
} else {
  console.warn(
    '[vega-webgpu] WebGPU is not supported in this environment; ' +
      "the 'webgpu' renderer will fall back to canvas rendering.",
  );
}

renderModule('webgpu', {
  renderer: webgpuSupported ? WebGPURenderer : CanvasRenderer,
  handler: CanvasHandler,
});

export { WebGPURenderer };
