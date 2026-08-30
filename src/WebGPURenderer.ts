import { Bounds, Renderer, domClear as clear } from 'vega-scenegraph';
import marks from './marks/index.js';
import type { GPUVegaCanvasContext, GPUVegaOptions, GPUVegaScene, RenderUniforms } from './types/context.js';
import { Color } from './util/color.js';
import { RenderQueue } from './util/renderQueue.js';
import resize from './util/resize.js';
import {
  createRenderPassDescriptor,
  defaultSampleCount,
  normalizeSampleCount,
  preferredColorFormat,
} from './util/webgpu.js';

import areaShader from './shaders/area.wgsl';
import gradientFillShader from './shaders/gradientFill.wgsl';
import imageShader from './shaders/image.wgsl';
import lineShader from './shaders/line.wgsl';
import pathShader from './shaders/path.wgsl';
import rectShader from './shaders/rect.wgsl';
import ruleShader from './shaders/rule.wgsl';
import shapeShader from './shaders/shape.wgsl';
import slineShader from './shaders/sline.wgsl';
import symbolShader from './shaders/symbol.wgsl';
import symbolShapeShader from './shaders/symbolShape.wgsl';
import textShader from './shaders/text.wgsl';

const viewBounds = (origin: readonly [number, number], width: number, height: number) =>
  new Bounds().set(0, 0, width, height).translate(-origin[0], -origin[1]);

interface PendingRender {
  scene: GPUVegaScene;
  markTypes?: string[];
}

export default class WebGPURenderer extends Renderer {
  wgOptions: GPUVegaOptions = {
    renderBatch: true,
    simpleLine: true,
    debugLog: false,
    cacheShapes: false,
    renderLock: true,
    sampleCount: defaultSampleCount,
  };

  private _canvas: (HTMLCanvasElement & { _pickCanvas?: HTMLCanvasElement }) | null = null;
  // Detached 2D canvas used only as a geometric scratch context for picking
  // (isPointInPath/isPointInStroke). It is never displayed. All visible
  // rendering, including text, goes through the single WebGPU canvas.
  private _pickCanvas: HTMLCanvasElement | null = null;
  private _pickContext: CanvasRenderingContext2D | null = null;
  private _ctx: GPUVegaCanvasContext | null = null;
  private _device: GPUDevice | null = null;
  private _msaaTexture: GPUTexture | null = null;
  private _msaaTextureDevice: GPUDevice | null = null;
  private _queue = new RenderQueue();
  private _uniforms: RenderUniforms = { resolution: [0, 0], origin: [0, 0], dpi: 1 };

  private _renderCount = 0;
  private _warnedTextureSize = false;

  private _isRendering = false;
  private _pendingRender: PendingRender | null = null;
  private _lastRender: PendingRender | null = null;
  private _renderPromise: Promise<void> = Promise.resolve();
  // Stands in for a deferred frame so awaiting callers follow it, not the
  // already-settled in-flight one.
  private _pendingPromise: Promise<void> | null = null;
  private _resolvePending: (() => void) | null = null;

  constructor(loader?: unknown) {
    super(loader);
  }

  override initialize(
    el: HTMLElement | null,
    width: number,
    height: number,
    origin: readonly number[],
    scaleFactor?: number,
    opt?: unknown,
  ): this {
    this._canvas = document.createElement('canvas');
    this._pickCanvas = document.createElement('canvas');
    this._pickContext = this._pickCanvas.getContext('2d');

    if (el) {
      el.setAttribute('style', 'position: relative;');
      this._canvas.setAttribute('class', 'marks');
      clear(el, 0);
      el.appendChild(this._canvas);
    }
    // The picking handler retrieves its 2D context through this reference,
    // since the WebGPU canvas cannot provide one.
    this._canvas._pickCanvas = this._pickCanvas;

    const ctx = this._canvas.getContext('webgpu') as GPUVegaCanvasContext | null;
    if (!ctx) {
      throw new Error('[vega-webgpu] Failed to obtain a WebGPU canvas context.');
    }
    ctx._renderer = this;
    ctx._renderQueue = this._queue;
    ctx._uniforms = this._uniforms;
    ctx._tx = 0;
    ctx._ty = 0;
    ctx._origin = [0, 0];
    ctx._ratio = 1;
    ctx._sampleCount = normalizeSampleCount(this.wgOptions.sampleCount);
    ctx._shaderCache = {};
    ctx._markCache = {};
    ctx._pathCache = {};
    ctx._pathCacheSize = 0;
    ctx._geometryCache = {};
    ctx._geometryCacheSize = 0;
    this._ctx = ctx;

    this._bgcolor = '#ffffff';

    // this method will invoke resize to size the canvas appropriately
    return super.initialize(el, width, height, origin, scaleFactor, opt);
  }

  override resize(width: number, height: number, origin: readonly number[], scaleFactor?: number): this {
    super.resize(width, height, origin, scaleFactor);

    const o: [number, number] = [this._origin[0], this._origin[1]];
    if (this._canvas && this._ctx && this._pickCanvas && this._pickContext) {
      resize(this._canvas, this._ctx, this._width, this._height, o, this._pickCanvas, this._pickContext);

      const ratio = window.devicePixelRatio || 1;
      this._uniforms = {
        resolution: [width, height],
        origin: o,
        dpi: ratio,
      };
      this._ctx._uniforms = this._uniforms;
    }

    return this;
  }

  override canvas(): HTMLCanvasElement | null {
    return this._canvas;
  }

  context(): GPUVegaCanvasContext | null {
    return this._ctx;
  }

  device(): GPUDevice | null {
    return this._device;
  }

  // No `dirty()` override: every frame redraws the whole scene, so tracking
  // per-item dirty bounds was pure overhead. Reinstate with partial redraw.

  private async _reinit(): Promise<{ device: GPUDevice; ctx: GPUVegaCanvasContext }> {
    let device = this._device;
    const ctx = this._ctx;
    if (!ctx) {
      throw new Error('[vega-webgpu] Renderer is not initialized.');
    }
    if (!device) {
      if (typeof navigator === 'undefined' || !navigator.gpu) {
        throw new Error('[vega-webgpu] WebGPU is not supported in this environment.');
      }
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) {
        throw new Error('[vega-webgpu] No suitable GPU adapter found.');
      }
      device = await adapter.requestDevice();
      this._device = device;
      this._handleDeviceLoss(device);

      ctx.configure({
        device,
        format: preferredColorFormat(),
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        alphaMode: 'premultiplied',
      });
      this._cacheShaders(device, ctx);
    }
    return { device, ctx };
  }

  private _handleDeviceLoss(device: GPUDevice): void {
    device.lost.then(info => {
      if (info.reason === 'destroyed') {
        return;
      }
      console.warn(`[vega-webgpu] GPU device lost (${info.message}); reinitializing.`);
      this._device = null;
      this._msaaTexture = null;
      this._msaaTextureDevice = null;
      if (this._ctx) {
        this._ctx._shaderCache = {};
        this._ctx._markCache = {};
      }
      // re-render the last known scene with a fresh device
      if (this._lastRender) {
        this._render(this._lastRender.scene, this._lastRender.markTypes);
      }
    });
  }

  /**
   * Unlike the base class, `_call` stays set after rendering: our `_render`
   * is asynchronous, so resource loads (images) that start mid-frame must
   * still find a live redraw callback once they complete.
   */
  override render(scene: GPUVegaScene, markTypes?: string[]): this {
    this._call = () => {
      this._render(scene, markTypes);
    };
    this._call();
    return this;
  }

  override _render(scene: GPUVegaScene, markTypes?: string[]): this {
    this._lastRender = { scene, markTypes };
    if (this.wgOptions.renderLock && this._isRendering) {
      // Without a stand-in promise renderAsync would resolve against the
      // in-flight frame, so callers would read the canvas before this scene ran.
      this._pendingRender = { scene, markTypes };
      if (!this._pendingPromise) {
        this._pendingPromise = new Promise<void>(resolve => {
          this._resolvePending = resolve;
        });
      }
      this._renderPromise = this._pendingPromise;
      return this;
    }
    this._isRendering = true;

    this._renderPromise = this._frame(scene, markTypes).catch(err => {
      console.error('[vega-webgpu] Render failed:', err);
      // One failure must not wedge the lock or strand awaiting callers.
      this._finishFrame();
    });
    return this;
  }

  /** Resolves when all in-flight render work has been submitted to the GPU. */
  override async renderAsync(scene: GPUVegaScene, markTypes?: string[]): Promise<this> {
    this.render(scene, markTypes);
    await this._renderPromise;
    // wait for pending resource loads (images) and the re-renders they trigger
    while (this._ready) {
      await this._ready;
      await this._renderPromise;
    }
    if (this._device) {
      await this._device.queue.onSubmittedWorkDone();
    }
    return this;
  }

  /** Applies a changed wgOptions.sampleCount: pipelines bake the sample
   * count, so the per-mark GPU resources and attachments are rebuilt. */
  private _applySampleCount(ctx: GPUVegaCanvasContext): void {
    const requested = normalizeSampleCount(this.wgOptions.sampleCount);
    if (requested === ctx._sampleCount) {
      return;
    }
    ctx._sampleCount = requested;
    ctx._markCache = {};
    this._msaaTexture?.destroy();
    this._msaaTexture = null;
    this._msaaTextureDevice = null;
  }

  private async _frame(scene: GPUVegaScene, markTypes?: string[]): Promise<void> {
    const { device, ctx } = await this._reinit();

    // WebGPU textures (and the swapchain) are capped at maxTextureDimension2D
    // (commonly 8192). Very tall or wide canvases, e.g. a long sorted bar list,
    // would otherwise fail attachment creation and spam validation errors.
    const maxDim = device.limits.maxTextureDimension2D;
    const cw = this._canvas?.width ?? 0;
    const chh = this._canvas?.height ?? 0;
    if (cw > maxDim || chh > maxDim) {
      if (!this._warnedTextureSize) {
        this._warnedTextureSize = true;
        console.warn(
          `[vega-webgpu] Canvas ${cw}x${chh} exceeds the GPU's maximum texture size ` +
            `(${maxDim}px); skipping WebGPU rendering for this view. Consider the canvas ` +
            `or svg renderer for very large outputs.`,
        );
      }
      this._finishFrame();
      return;
    }

    this._applySampleCount(ctx);
    this._queue.startFrame();

    const o = this._origin;
    const w = this._width;
    const h = this._height;
    const vb = viewBounds([o[0], o[1]], w, h);

    ctx._tx = 0;
    ctx._ty = 0;

    const t1 = performance.now();
    this.draw(device, ctx, scene, vb, markTypes);
    const t2 = performance.now();

    // One pass for the whole frame: clears to the background color, draws
    // in scenegraph order, and resolves the MSAA attachment once.
    const renderPassDescriptor = createRenderPassDescriptor('Frame', this.clearColor());
    if (ctx._sampleCount > 1) {
      renderPassDescriptor.colorAttachments[0].view = this.msaaTexture(device).createView();
      renderPassDescriptor.colorAttachments[0].resolveTarget = ctx.getCurrentTexture().createView();
    } else {
      renderPassDescriptor.colorAttachments[0].view = ctx.getCurrentTexture().createView();
    }
    this._queue.submit(device, renderPassDescriptor, [this._canvas?.width ?? 0, this._canvas?.height ?? 0]);

    requestAnimationFrame(() => this._endFrame(t1, t2));
  }

  private _endFrame(t1: number, t2: number): void {
    if (this.wgOptions.debugLog === true) {
      const t3 = performance.now();
      console.log(
        `Render Time (${this._renderCount++}): ${(t3 - t1).toFixed(3)}ms ` +
          `(Draw: ${(t2 - t1).toFixed(3)}ms, WebGPU: ${(t3 - t2).toFixed(3)}ms)`,
      );
    }
    this._finishFrame();
  }

  /**
   * Releases the render lock and flushes a coalesced request, if any.
   *
   * Every exit from a frame (completion, early return, or failure) must come
   * through here, or `_isRendering` stays stuck and awaiting callers never wake.
   */
  private _finishFrame(): void {
    this._isRendering = false;

    const pending = this._pendingRender;
    this._pendingRender = null;
    const resolve = this._resolvePending;
    this._pendingPromise = null;
    this._resolvePending = null;

    if (pending) {
      this._render(pending.scene, pending.markTypes);
      // Settle only once the flushed frame does, so callers track real work.
      this._renderPromise.then(
        () => resolve?.(),
        () => resolve?.(),
      );
      return;
    }

    resolve?.();
  }

  /** Re-renders the most recent scene (e.g. after options changed). */
  frame(): this {
    if (this._lastRender) {
      this._render(this._lastRender.scene, this._lastRender.markTypes);
    }
    return this;
  }

  draw(device: GPUDevice, ctx: GPUVegaCanvasContext, scene: GPUVegaScene, bounds: Bounds, markTypes?: string[]): void {
    if (scene.marktype !== 'group' && markTypes != null && !markTypes.includes(scene.marktype)) {
      return;
    }
    const mark = marks[scene.marktype];
    if (mark == null) {
      console.error(`[vega-webgpu] Unknown mark type: '${scene.marktype}'`);
      return;
    }
    mark.draw.call(this, device, ctx, scene, bounds, markTypes);
  }

  /** Multisampled color attachment, resolved into the canvas each frame. */
  msaaTexture(device?: GPUDevice): GPUTexture {
    const gpu = device ?? this._device;
    const canvas = this._canvas;
    if (!gpu || !canvas) {
      throw new Error('[vega-webgpu] Cannot create the MSAA texture before initialization.');
    }
    const existing = this._msaaTexture;
    if (
      existing &&
      this._msaaTextureDevice === gpu &&
      existing.width === canvas.width &&
      existing.height === canvas.height
    ) {
      return existing;
    }
    existing?.destroy();
    this._msaaTexture = gpu.createTexture({
      label: 'MSAA Color Texture',
      size: [canvas.width, canvas.height, 1],
      format: preferredColorFormat(),
      dimension: '2d',
      sampleCount: this._ctx?._sampleCount ?? defaultSampleCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this._msaaTextureDevice = gpu;
    return this._msaaTexture;
  }

  clearColor(): GPUColor {
    const bg = this._bgcolor ? Color.from(this._bgcolor) : null;
    return bg ? { r: bg.r, g: bg.g, b: bg.b, a: bg.a } : { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
  }

  private _cacheShaders(device: GPUDevice, ctx: GPUVegaCanvasContext): void {
    ctx._shaderCache = {
      Symbol: device.createShaderModule({ code: symbolShader, label: 'Symbol Shader' }),
      SymbolShape: device.createShaderModule({ code: symbolShapeShader, label: 'Symbol Shape Shader' }),
      Line: device.createShaderModule({ code: lineShader, label: 'Line Shader' }),
      Rule: device.createShaderModule({ code: ruleShader, label: 'Rule Shader' }),
      SLine: device.createShaderModule({ code: slineShader, label: 'SLine Shader' }),
      Path: device.createShaderModule({ code: pathShader, label: 'Path Shader' }),
      Rect: device.createShaderModule({ code: rectShader, label: 'Rect Shader' }),
      // Group backgrounds are rounded rectangles, so they reuse the rect shader.
      Group: device.createShaderModule({ code: rectShader, label: 'Group Shader' }),
      GradientFill: device.createShaderModule({ code: gradientFillShader, label: 'Gradient Fill Shader' }),
      Image: device.createShaderModule({ code: imageShader, label: 'Image Shader' }),
      Text: device.createShaderModule({ code: textShader, label: 'Text Shader' }),
      Shape: device.createShaderModule({ code: shapeShader, label: 'Shape Shader' }),
      Area: device.createShaderModule({ code: areaShader, label: 'Area Shader' }),
    };
  }
}
