import { Bounds, Renderer, domClear as clear } from 'vega-scenegraph';
import { canvasTextDrift } from './util/canvasDrift.js';
import marks from './marks/index.js';
import { drawClipMask, blendCompositeElement } from './marks/util.js';
import type { ClipMaskTarget, GPUVegaCanvasContext, GPUVegaOptions, GPUVegaScene } from './types/context.js';
import { Color } from './util/color.js';
import { GpuTimer } from './util/gpuTimer.js';
import { RenderQueue, type FrameTargets } from './util/renderQueue.js';
import resize, { pixelRatio } from './util/resize.js';
import { bufferPool } from './util/bufferManager.js';
import { defaultSampleCount, normalizeSampleCount, preferredColorFormat } from './util/webgpu.js';

const viewBounds = (origin: readonly [number, number], width: number, height: number) =>
  new Bounds().set(0, 0, width, height).translate(-origin[0], -origin[1]);

// Upper bound on a frame capture, so a stalled readback reports instead of
// hanging its caller.
const CAPTURE_TIMEOUT_MS = 10_000;
const MAX_DEVICE_RECOVERIES = 3;
/**
 * Texture size every WebGPU device must support, used until the real adapter
 * limit is known. Nothing is over-committed by assuming it, since a device
 * cannot report less.
 */
const MIN_TEXTURE_DIM = 8192;
/** Quiet time before a settling frame redraws at full quality. */
const SETTLE_DELAY_MS = 150;

/**
 * The renderer currently drawing into an element.
 *
 * vega swaps renderers by dropping the old one and building a new one, without
 * telling the old one to let go, so its device and everything on it would stay
 * alive for as long as the page did. Taking over an element releases whoever
 * held it before.
 */
const holders = new WeakMap<HTMLElement, WebGPURenderer>();

interface PendingRender {
  scene: GPUVegaScene;
  markTypes?: string[];
  /** Draw at full quality, however long that takes. */
  settle?: boolean;
}

/** A texture the frame keeps, with the device it was made on. */
interface TextureSlot {
  texture: GPUTexture | null;
  device: GPUDevice | null;
}

export default class WebGPURenderer extends Renderer {
  wgOptions: GPUVegaOptions = {
    debugLog: false,
    cacheShapes: true,
    exactRotatedText: true,
    canvasTextDrift: false,
    renderLock: true,
    offscreen: false,
    sampleCount: defaultSampleCount,
    redrawOnZoom: true,
  };

  private _canvas: (HTMLCanvasElement & { _pickCanvas?: HTMLCanvasElement }) | null = null;
  // Detached 2D canvas used only as a geometric scratch context for picking
  // (isPointInPath/isPointInStroke). It is never displayed. All visible
  // rendering, including text, goes through the single WebGPU canvas.
  private _pickCanvas: HTMLCanvasElement | null = null;
  private _pickContext: CanvasRenderingContext2D | null = null;
  private _ctx: GPUVegaCanvasContext | null = null;
  private _device: GPUDevice | null = null;
  private _msaa: TextureSlot = { texture: null, device: null };
  /** Whether the last frame had to draw off the frame. Read by the tests. */
  private _offFrame = false;
  private _mask: TextureSlot = { texture: null, device: null };
  private _layerTexture: GPUTexture | null = null;
  private _layerResolve: GPUTexture | null = null;
  private _backdropTexture: GPUTexture | null = null;
  private _blendTextureDevice: GPUDevice | null = null;
  private _offscreen: TextureSlot = { texture: null, device: null };
  private _queue = new RenderQueue();

  private _renderCount = 0;

  /** Reason the GPU device was lost, if it ever was. Set for every reason. */
  deviceLostReason: string | null = null;
  /** Set to an object to accumulate per-mark draw time. Diagnostic only. */
  markTimings: Record<string, number> | null = null;
  /** Number of GPU devices this renderer has created. */
  deviceGeneration = 0;
  private _recoveries = 0;

  private _pendingDestroy: { destroy(): void }[] = [];

  private _capture: {
    resolve: (v: { width: number; height: number; data: Uint8Array }) => void;
    reject: (e: unknown) => void;
  } | null = null;

  private _isRendering = false;
  private _pendingRender: PendingRender | null = null;
  private _gpuTimer: GpuTimer | null = null;
  private _finalized = false;
  private _settling = false;
  private _settleTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastRender: PendingRender | null = null;
  private _renderPromise: Promise<void> = Promise.resolve();
  // Stands in for a deferred frame so awaiting callers follow it, not the
  // already-settled in-flight one.
  private _pendingPromise: Promise<void> | null = null;
  private _resolvePending: (() => void) | null = null;
  private _dpr: { query: MediaQueryList; onChange: () => void } | null = null;
  private _scaleFactor: number | undefined;
  private _maxTextureDim = MIN_TEXTURE_DIM;
  private _lockedRatio: number | null = null;
  private _warnedRatioCap = false;

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
    // re-initializing this renderer, or taking the element off another one
    this._releaseGpu();
    if (el) {
      const held = holders.get(el);
      if (held && held !== this) {
        held.finalize();
      }
      holders.set(el, this);
    }

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
    ctx._uniforms = { resolution: [0, 0], dpi: 1 };
    ctx._tx = 0;
    ctx._ty = 0;
    ctx._origin = [0, 0];
    ctx._ratio = 1;
    ctx._sampleCount = normalizeSampleCount(this.wgOptions.sampleCount);
    ctx._opaqueBackdrop = false;
    ctx._shaderCache = {};
    ctx._pipelineCache = {};
    ctx._markCache = {};
    ctx._pathCache = {};
    ctx._pathCacheSize = 0;
    ctx._geometryCache = {};
    ctx._geometryCacheSize = 0;
    this._ctx = ctx;

    // this method will invoke resize to size the canvas appropriately
    return super.initialize(el, width, height, origin, scaleFactor, opt);
  }

  override resize(width: number, height: number, origin: readonly number[], scaleFactor?: number): this {
    super.resize(width, height, origin, scaleFactor);
    this._scaleFactor = scaleFactor;
    this._watchPixelRatio();

    const o: [number, number] = [this._origin[0], this._origin[1]];
    if (this._canvas && this._ctx && this._pickCanvas && this._pickContext) {
      const ratio = this._pixelRatio(this._width, this._height, scaleFactor);
      resize(this._canvas, this._ctx, this._width, this._height, o, this._pickCanvas, this._pickContext, ratio);

      // devicePixelRatio disagrees with this for a detached canvas or an
      // explicit scaleFactor.
      this._ctx._uniforms = { resolution: [width, height], dpi: this._ctx._ratio };
    }

    return this;
  }

  override canvas(): HTMLCanvasElement | null {
    return this._canvas;
  }

  /** Stops following zoom, so the canvas keeps the size it has. */
  private _unwatchPixelRatio(): void {
    if (this._dpr) {
      this._dpr.query.removeEventListener('change', this._dpr.onChange);
      this._dpr = null;
    }
  }

  /**
   * Takes the real ceiling from the adapter in place of the assumed minimum,
   * and re-sizes when that changes what the canvas is allowed to be.
   */
  private _applyTextureLimit(limit: number): void {
    if (limit === this._maxTextureDim) {
      return;
    }
    this._maxTextureDim = limit;
    const want = this._pixelRatio(this._width, this._height, this._scaleFactor);
    if (this._ctx && this._ctx._ratio !== want) {
      this.resize(this._width, this._height, this._origin, this._scaleFactor);
    }
  }

  /**
   * Device pixels per logical pixel for the canvas, after holding it against
   * browser zoom when `redrawOnZoom` is off and capping it to what the GPU can
   * actually allocate.
   */
  private _pixelRatio(width: number, height: number, scaleFactor?: number): number {
    let ratio = this._canvas ? pixelRatio(this._canvas, scaleFactor) : (scaleFactor ?? 1);
    if (scaleFactor == null && !this.wgOptions.redrawOnZoom) {
      this._lockedRatio ??= ratio;
      ratio = this._lockedRatio;
    }

    // The canvas is a texture, so the adapter's 2D limit is a hard ceiling.
    // Dropping to a ratio that fits keeps a very large view on screen, where
    // refusing to draw it left the user with a blank chart.
    const largest = Math.max(width, height);
    const cap = largest > 0 ? this._maxTextureDim / largest : ratio;
    if (ratio <= cap) {
      return ratio;
    }
    if (!this._warnedRatioCap) {
      this._warnedRatioCap = true;
      console.warn(
        `[vega-webgpu] ${width}x${height} at ${ratio}x needs ${Math.ceil(largest * ratio)}px, ` +
          `over the GPU's maximum texture size (${this._maxTextureDim}px). ` +
          `Drawing at ${cap.toFixed(3)}x instead, so the view is softer than requested.`,
      );
    }
    return cap;
  }

  /**
   * Redraws when the device pixel ratio changes, which browser zoom does
   * without changing the view's width or height, so nothing else asks for it.
   * A matchMedia query only fires for the ratio it was built with, so each
   * change registers the next one.
   */
  private _watchPixelRatio(): void {
    if (this._scaleFactor != null || !this.wgOptions.redrawOnZoom) {
      // the option can be turned off after a watch was already registered
      this._unwatchPixelRatio();
      return;
    }
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    if (this._dpr) {
      if (this._dpr.query.media === `(resolution: ${ratio}dppx)`) {
        return;
      }
      this._dpr.query.removeEventListener('change', this._dpr.onChange);
    }
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`);
    // Weak, since the query outlives a renderer vega dropped without finalizing.
    const self = new WeakRef(this);
    const onChange = () => {
      const renderer = self.deref();
      if (!renderer || renderer._finalized) {
        query.removeEventListener('change', onChange);
        return;
      }
      renderer.resize(renderer._width, renderer._height, renderer._origin);
      renderer.frame();
    };
    query.addEventListener('change', onChange);
    this._dpr = { query, onChange };
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
      device = await adapter.requestDevice({
        // timestamps measure gpu time without stalling the frame, where offered
        requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
        // a device gets the 8192 default unless it asks for what the adapter has
        requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
      });
      this._gpuTimer = GpuTimer.create(device);
      this._device = device;
      this._applyTextureLimit(device.limits.maxTextureDimension2D);
      this.deviceGeneration++;
      this._handleDeviceLoss(device);

      ctx.configure({
        device,
        format: preferredColorFormat(),
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        alphaMode: 'premultiplied',
      });
    }
    return { device, ctx };
  }

  /**
   * Drops the device and everything built on it. Pipelines, textures and
   * buffers all belong to a device, so none of them outlive it.
   */
  private _dropDevice(): void {
    this._device = null;
    this._gpuTimer = null;
    this._msaa = { texture: null, device: null };
    this._mask = { texture: null, device: null };
    this._layerTexture = null;
    this._layerResolve = null;
    this._backdropTexture = null;
    this._blendTextureDevice = null;
    this._offscreen = { texture: null, device: null };
    this._clipMasks = [];
    this._clipMaskNext = 0;
    this._clipPlaceholder = null;
    this._clipPlaceholderView = null;
    if (this._ctx) {
      this._ctx._shaderCache = {};
      this._ctx._pipelineCache = {};
      this._ctx._markCache = {};
    }
  }

  /**
   * A device is never destroyed from here, so every loss is the browser's,
   * including reason 'destroyed' (memory pressure reclaims a device that way).
   * Keeping the dead one leaves the renderer permanently broken.
   */
  private _handleDeviceLoss(device: GPUDevice): void {
    device.lost.then(info => {
      this.deviceLostReason = `${info.reason}: ${info.message}`;
      if (this._device !== device) {
        return; // already replaced
      }
      if (this._finalized) {
        return; // finalize() destroyed it on purpose
      }
      console.warn(`[vega-webgpu] GPU device lost (${info.reason}: ${info.message}); reinitializing.`);
      this._dropDevice();
      // Bounded, so a device the browser keeps reclaiming cannot spin here.
      if (this._lastRender && this._recoveries < MAX_DEVICE_RECOVERIES) {
        this._recoveries++;
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

  override _render(scene: GPUVegaScene, markTypes?: string[], settle?: boolean): this {
    this._lastRender = { scene, markTypes };
    if (this.wgOptions.renderLock && this._isRendering) {
      // Without a stand-in promise renderAsync would resolve against the
      // in-flight frame, so callers would read the canvas before this scene ran.
      this._pendingRender = { scene, markTypes, settle };
      if (!this._pendingPromise) {
        this._pendingPromise = new Promise<void>(resolve => {
          this._resolvePending = resolve;
        });
      }
      this._renderPromise = this._pendingPromise;
      return this;
    }
    this._isRendering = true;

    this._renderPromise = this._frame(scene, markTypes, settle).catch(err => {
      console.error('[vega-webgpu] Render failed:', err);
      // One failure must not wedge the lock or strand awaiting callers.
      const capture = this._capture;
      this._capture = null;
      capture?.reject(err);
      this._finishFrame();
    });
    return this;
  }

  /**
   * Resolves when the frame has been submitted to the GPU. vega awaits this on
   * every frame, so waiting for the GPU to finish here would stop the cpu from
   * ever running ahead of it. A caller that needs the pixels reads them back
   * through captureFrame, which is ordered behind the frame in the same queue.
   */
  override async renderAsync(scene: GPUVegaScene, markTypes?: string[]): Promise<this> {
    this.render(scene, markTypes);
    await this._renderPromise;
    // wait for pending resource loads (images) and the re-renders they trigger
    while (this._ready) {
      await this._ready;
      await this._renderPromise;
    }
    return this;
  }

  /** Drops the device and the timer, without marking the renderer finished. */
  private _releaseGpu(): void {
    if (this._settleTimer !== null) {
      clearTimeout(this._settleTimer);
      this._settleTimer = null;
    }
    const device = this._device;
    this._gpuTimer?.destroy();
    this._dropDevice();
    device?.destroy();
  }

  /**
   * Releases the GPU device and everything built on it.
   *
   * vega's own View.finalize does not reach the renderer, so a page that
   * creates and discards views leaks a device each time. Nothing recreates one
   * after this, so call it when the view is going away for good.
   */
  finalize(): void {
    this._finalized = true;
    this._unwatchPixelRatio();
    this._releaseGpu();
  }

  /**
   * Gpu time for the most recently measured frame, in milliseconds, or 0 where
   * the adapter offers no timestamps. Sampled a frame or more behind, so it
   * never stalls the one being drawn.
   */
  get gpuFrameTime(): number {
    return this._gpuTimer?.lastMs ?? 0;
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
    this._msaa.texture?.destroy();
    this._msaa = { texture: null, device: null };
    // the layer takes the frame's sample count, so it is stale too
    this._layerTexture?.destroy();
    this._layerTexture = null;
    this._blendTextureDevice = null;
  }

  private async _frame(scene: GPUVegaScene, markTypes?: string[], settle?: boolean): Promise<void> {
    const tFrameStart = performance.now();
    const { device, ctx } = await this._reinit();

    this._applySampleCount(ctx);
    this._queue.startFrame((blendMode, clip) => blendCompositeElement(ctx, device, blendMode, clip));

    const o = this._origin;
    const w = this._width;
    const h = this._height;
    const vb = viewBounds([o[0], o[1]], w, h);

    ctx._tx = 0;
    ctx._ty = 0;
    // The group visit restores these as it unwinds, so this is only in case a
    // frame gave up part way through one.
    ctx._clip = undefined;
    ctx._clipRound = undefined;
    ctx._clipMask = undefined;
    this._clipMaskNext = 0;
    // Read per frame rather than once: vega sets the background after it builds
    // the renderer, and a view can change it later.
    ctx._opaqueBackdrop = (this.clearColor() as GPUColorDict).a >= 1;
    ctx._textDrift = this.wgOptions.canvasTextDrift ? canvasTextDrift(scene, o, ctx._uniforms.dpi || 1) : null;

    const t1 = performance.now();
    this._settling = settle === true;
    try {
      this.draw(device, ctx, scene, vb, markTypes);
    } finally {
      this._settling = false;
    }
    const t2 = performance.now();

    // One pass for the whole frame: clears to the background color, draws in
    // scenegraph order (there is no depth attachment), and resolves the MSAA
    // attachment once.
    const target = this.wgOptions.offscreen ? this.offscreenTexture(device) : ctx.getCurrentTexture();
    const multisampled = ctx._sampleCount > 1;
    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: 'Frame Render Pass Descriptor',
      colorAttachments: [
        {
          view: multisampled ? this.msaaTexture(device, ctx._sampleCount).createView() : target.createView(),
          resolveTarget: multisampled ? target.createView() : undefined,
          clearValue: this.clearColor(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };
    if (this._gpuTimer) {
      renderPassDescriptor.timestampWrites = this._gpuTimer.timestampWrites();
    }
    const tSubmit = performance.now();
    this._offFrame = this._queue.drawsOffFrame();
    // Built only when a draw asked for one. They are the size of the canvas,
    // and a frame that neither masks nor blends should not carry them.
    let targets: FrameTargets | null = null;
    if (this._offFrame) {
      const blend = this.blendTargets(device, ctx._sampleCount);
      targets = {
        target,
        maskView: this.maskTexture(device).createView(),
        layerView: blend.layer.createView(),
        layerResolve: ctx._sampleCount > 1 ? blend.resolve.createView() : null,
        backdrop: blend.backdrop,
      };
    }
    this._queue.submit(
      device,
      renderPassDescriptor,
      [this._canvas?.width ?? 0, this._canvas?.height ?? 0],
      this._gpuTimer,
      targets,
    );
    if (this.markTimings) {
      this.markTimings['_draw'] = (this.markTimings['_draw'] ?? 0) + (t2 - t1);
      this.markTimings['_submit'] = (this.markTimings['_submit'] ?? 0) + (performance.now() - tSubmit);
      this.markTimings['_reinit'] = (this.markTimings['_reinit'] ?? 0) + (t1 - tFrameStart);
    }

    if (this._capture) {
      const capture = this._capture;
      this._capture = null;
      this._readback(device, target).then(capture.resolve, capture.reject);
    }

    // The work is on the GPU, so the lock goes now. Waiting for the next
    // animation frame to release it deferred any render arriving inside that
    // window, which is a dragged slider rendering a frame behind.
    this._endFrame(t1, t2);
  }

  private _endFrame(t1: number, t2: number): void {
    if (this.wgOptions.debugLog === true) {
      const t3 = performance.now();
      console.log(
        `Render Time (${this._renderCount++}): ${(t3 - t1).toFixed(3)}ms ` +
          `(Draw: ${(t2 - t1).toFixed(3)}ms, Encode: ${(t3 - t2).toFixed(3)}ms)`,
      );
    }
    this._finishFrame();
  }

  /**
   * Renders a frame and reads the result straight off the GPU.
   *
   * Presentation is what makes canvas content visible to screenshots and to
   * toDataURL, and a headless Linux runner never composites, so both come back
   * blank there. Copying the texture bypasses presentation entirely.
   */
  async captureFrame(timeoutMs = CAPTURE_TIMEOUT_MS): Promise<{ width: number; height: number; data: Uint8Array }> {
    try {
      return await this._captureOnce(timeoutMs);
    } catch {
      // A device that goes away mid-capture takes its readback buffer with it,
      // and mapAsync then rejects with the instance already gone. Rebuild and
      // take the frame again, letting a second failure through.
      this._dropDevice();
      return await this._captureOnce(timeoutMs);
    }
  }

  private _captureOnce(timeoutMs: number): Promise<{ width: number; height: number; data: Uint8Array }> {
    return new Promise((resolve, reject) => {
      if (!this._lastRender) {
        reject(new Error('[vega-webgpu] Nothing has been rendered yet.'));
        return;
      }
      // Never hang. A capture that cannot complete has to say so, otherwise the
      // caller just stops, with no clue whether the frame, the copy or the
      // buffer mapping was the part that never finished.
      const timer = setTimeout(() => {
        if (this._capture) {
          this._capture = null;
          reject(
            new Error(
              `[vega-webgpu] Frame capture did not finish within ${timeoutMs}ms ` +
                `(rendering=${this._isRendering}, pending=${this._pendingRender !== null}).`,
            ),
          );
        }
      }, timeoutMs);
      const done =
        <T>(fn: (v: T) => void) =>
        (value: T) => {
          clearTimeout(timer);
          fn(value);
        };
      this._capture = { resolve: done(resolve), reject: done(reject) };
      // A capture is the finished picture, so it draws at full quality.
      this._render(this._lastRender.scene, this._lastRender.markTypes, true);
    });
  }

  /** Copies a texture into a mappable buffer and unpads it to tight RGBA rows. */
  private async _readback(
    device: GPUDevice,
    texture: GPUTexture,
  ): Promise<{ width: number; height: number; data: Uint8Array }> {
    const width = texture.width;
    const height = texture.height;
    // copyTextureToBuffer requires each row to start on a 256 byte boundary
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = device.createBuffer({
      label: 'Capture Readback',
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'Capture Encoder' });
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height, 1]);
    device.queue.submit([encoder.finish()]);

    await buffer.mapAsync(GPUMapMode.READ);
    const padded = new Uint8Array(buffer.getMappedRange());
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      data.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
    }
    buffer.unmap();
    // The texels come back in the canvas format, which is bgra8unorm on most
    // platforms. Callers want RGBA.
    if (preferredColorFormat() === 'bgra8unorm') {
      for (let i = 0; i < data.length; i += 4) {
        const b = data[i];
        data[i] = data[i + 2];
        data[i + 2] = b;
      }
    }
    // The surface is premultiplied, but getImageData and toDataURL both hand
    // back straight alpha, so callers comparing the two need the same.
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a !== 0 && a !== 255) {
        data[i] = Math.min(255, Math.round((data[i] * 255) / a));
        data[i + 1] = Math.min(255, Math.round((data[i + 1] * 255) / a));
        data[i + 2] = Math.min(255, Math.round((data[i + 2] * 255) / a));
      }
    }
    buffer.destroy();
    return { width, height, data };
  }

  /**
   * Queues a GPU resource for destruction once the current frame is submitted.
   * Safe to call from inside a mark's draw, where the resource may still be
   * referenced by a queued but not yet encoded draw.
   */
  deferDestroy(resource: { destroy(): void }): void {
    this._pendingDestroy.push(resource);
  }

  /**
   * Releases the render lock and flushes a coalesced request, if any.
   *
   * Every exit from a frame (completion, early return, or failure) must come
   * through here, or `_isRendering` stays stuck and awaiting callers never wake.
   */
  private _finishFrame(): void {
    this._isRendering = false;

    // The frame is submitted, so the buffers its draws used can go. An
    // implementation keeps a destroyed buffer alive until the commands
    // referencing it have run.
    if (this._device) {
      bufferPool(this._device).release();
    }

    if (this._pendingDestroy.length > 0) {
      for (const resource of this._pendingDestroy) {
        resource.destroy();
      }
      this._pendingDestroy = [];
    }

    const pending = this._pendingRender;
    this._pendingRender = null;
    const resolve = this._resolvePending;
    this._pendingPromise = null;
    this._resolvePending = null;

    if (pending) {
      this._render(pending.scene, pending.markTypes, pending.settle);
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

  /** True while drawing a frame that is not allowed to take a cheaper path. */
  get settling(): boolean {
    return this._settling;
  }

  /**
   * Asks for one more frame once renders stop arriving, for a mark that took a
   * cheaper path to keep up. Each render pushes it back, so a drag pays nothing
   * and the frame it comes to rest on is the full quality one.
   */
  requestSettle(): void {
    if (this._finalized || this._settling) {
      return;
    }
    if (this._settleTimer !== null) {
      clearTimeout(this._settleTimer);
    }
    this._settleTimer = setTimeout(() => {
      this._settleTimer = null;
      if (this._lastRender) {
        this._render(this._lastRender.scene, this._lastRender.markTypes, true);
      }
    }, SETTLE_DELAY_MS);
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
    // A mark can carry a clip of its own, and where that clip is a path it is
    // a coverage mask. It is drawn here rather than inside the mark because
    // getMarkResources writes the flag that says a mask is bound, and every
    // mark calls that before it reaches its own clip.
    //
    // A group mark carries one the same way any other mark does, and vega's
    // renderer clips it here too, before the mark type has been looked at.
    const outerMask = ctx._clipMask;
    const own = (scene as { clip?: unknown }).clip;
    if (typeof own === 'function') {
      ctx._clipMask = drawClipMask(device, ctx, own as (c?: unknown) => unknown, bounds) ?? outerMask;
    }
    try {
      this.drawMark(mark, device, ctx, scene, bounds, markTypes);
    } finally {
      ctx._clipMask = outerMask;
    }
  }

  /** The mark's own draw, timed when a benchmark has asked for it. */
  private drawMark(
    mark: (typeof marks)[string],
    device: GPUDevice,
    ctx: GPUVegaCanvasContext,
    scene: GPUVegaScene,
    bounds: Bounds,
    markTypes?: string[],
  ): void {
    if (this.markTimings) {
      const t0 = performance.now();
      mark.draw.call(this, device, ctx, scene, bounds, markTypes);
      const key = scene.marktype;
      this.markTimings[key] = (this.markTimings[key] ?? 0) + (performance.now() - t0);
      return;
    }
    mark.draw.call(this, device, ctx, scene, bounds, markTypes);
  }

  /**
   * A 1x1 texture bound wherever a mark has no clip path, so the mask binding
   * is always satisfiable. Nothing reads it: the uniform flag is what decides
   * whether the shader looks at the mask at all.
   */
  clipMaskPlaceholder(device: GPUDevice): GPUTexture {
    if (!this._clipPlaceholder || this._clipPlaceholder.device !== device) {
      this._clipPlaceholder?.texture.destroy();
      const texture = device.createTexture({
        label: 'Clip Mask Placeholder',
        size: [1, 1, 1],
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this._clipPlaceholder = { device, texture };
      this._clipPlaceholderView = null;
    }
    return this._clipPlaceholder.texture;
  }

  /**
   * A coverage target for one clip path, which has to survive while every mark
   * inside that clip draws. The stroke mask is one texture cleared by each
   * pass, so a clip cannot share it: two clipped groups in a frame would
   * overwrite each other before either one's marks were encoded.
   *
   * Pooled by index and reset per frame, so a scene with the same clips each
   * frame allocates nothing after the first.
   */
  acquireClipMask(device: GPUDevice, samples: number): ClipMaskTarget | null {
    const canvas = this._canvas;
    if (!canvas) {
      return null;
    }
    const [w, h] = [canvas.width, canvas.height];
    const held = this._clipMasks[this._clipMaskNext];
    if (held && held.device === device && held.width === w && held.height === h && held.samples === samples) {
      this._clipMaskNext++;
      return held;
    }
    held?.release();
    const resolved = device.createTexture({
      label: `Clip Mask ${this._clipMaskNext}`,
      size: [w, h, 1],
      format: 'r8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    // Coverage of a filled path comes from rasterization rather than from a
    // distance function, so a single sampled mask cuts with a hard edge where
    // canvas antialiases the clip. Multisampled and resolved, it carries the
    // same quarter steps every other triangulated edge does.
    const multi =
      samples > 1
        ? device.createTexture({
            label: `Clip Mask ${this._clipMaskNext} MSAA`,
            size: [w, h, 1],
            format: 'r8unorm',
            sampleCount: samples,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          })
        : null;
    const entry: ClipMaskTarget = {
      device,
      width: w,
      height: h,
      samples,
      attachment: (multi ?? resolved).createView(),
      resolve: multi ? resolved.createView() : undefined,
      read: resolved.createView(),
      release: () => {
        resolved.destroy();
        multi?.destroy();
      },
    };
    this._clipMasks[this._clipMaskNext] = entry;
    this._clipMaskNext++;
    return entry;
  }

  private _clipMasks: ClipMaskTarget[] = [];
  private _clipMaskNext = 0;

  /** The placeholder's view, held so a bind group per draw does not build one. */
  clipMaskPlaceholderView(device: GPUDevice): GPUTextureView {
    const texture = this.clipMaskPlaceholder(device);
    if (!this._clipPlaceholderView || this._clipPlaceholder?.texture !== texture) {
      this._clipPlaceholderView = texture.createView();
    }
    return this._clipPlaceholderView;
  }

  private _clipPlaceholder: { device: GPUDevice; texture: GPUTexture } | null = null;
  private _clipPlaceholderView: GPUTextureView | null = null;

  /**
   * Single sampled coverage target, for a stroke that has to be composited as
   * one shape rather than band by band. One per frame is enough: each mask pass
   * clears it, and the composite that follows reads it before the next pass
   * fills it again.
   */
  maskTexture(device?: GPUDevice): GPUTexture {
    return this.canvasTexture(this._mask, device, 'mask texture', size => ({
      label: 'Coverage Mask Texture',
      size,
      format: 'r8unorm',
      dimension: '2d',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    }));
  }

  /**
   * The texture in `slot`, rebuilt when the device or the canvas size changed.
   * Three of the frame's targets are sized to the canvas and all three go
   * stale on the same two conditions.
   */
  private canvasTexture(
    slot: TextureSlot,
    device: GPUDevice | undefined,
    what: string,
    describe: (size: [number, number, number]) => GPUTextureDescriptor,
  ): GPUTexture {
    const gpu = device ?? this._device;
    const canvas = this._canvas;
    if (!gpu || !canvas) {
      throw new Error(`[vega-webgpu] Cannot create the ${what} before initialization.`);
    }
    const existing = slot.texture;
    if (existing && slot.device === gpu && existing.width === canvas.width && existing.height === canvas.height) {
      return existing;
    }
    existing?.destroy();
    slot.texture = gpu.createTexture(describe([canvas.width, canvas.height, 1]));
    slot.device = gpu;
    return slot.texture;
  }

  /**
   * Where a mark whose blend has to be evaluated in a shader is drawn, and the
   * copy of the frame underneath it. The layer takes the frame's own format and
   * sample count, so a mark draws into it through the pipelines it already has.
   */
  blendTargets(device: GPUDevice, samples: number): { layer: GPUTexture; resolve: GPUTexture; backdrop: GPUTexture } {
    const canvas = this._canvas;
    if (!canvas) {
      throw new Error('[vega-webgpu] Cannot create the blend targets before initialization.');
    }
    const stale =
      this._blendTextureDevice !== device ||
      !this._layerResolve ||
      this._layerResolve.width !== canvas.width ||
      this._layerResolve.height !== canvas.height;
    if (stale) {
      this._layerTexture?.destroy();
      this._layerResolve?.destroy();
      this._backdropTexture?.destroy();
      this._layerTexture = null;
      this._layerResolve = device.createTexture({
        label: 'Blend Layer Resolve',
        size: [canvas.width, canvas.height, 1],
        format: preferredColorFormat(),
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this._backdropTexture = device.createTexture({
        label: 'Blend Backdrop',
        size: [canvas.width, canvas.height, 1],
        format: preferredColorFormat(),
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      this._blendTextureDevice = device;
    }
    if (samples > 1 && !this._layerTexture) {
      this._layerTexture = device.createTexture({
        label: 'Blend Layer',
        size: [canvas.width, canvas.height, 1],
        format: preferredColorFormat(),
        sampleCount: samples,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    const resolve = this._layerResolve as GPUTexture;
    return {
      layer: samples > 1 ? (this._layerTexture as GPUTexture) : resolve,
      resolve,
      backdrop: this._backdropTexture as GPUTexture,
    };
  }

  /**
   * Whether the last frame needed a pass outside the frame's own, for a
   * coverage mask or a blend evaluated against a copy of it. The fast path for
   * a blend is silent when it stops being taken, so a test watches this.
   */
  drewOffFrame(): boolean {
    return this._offFrame;
  }

  /** Multisampled color attachment, resolved into the canvas each frame. */
  msaaTexture(device: GPUDevice, samples: number): GPUTexture {
    return this.canvasTexture(this._msaa, device, 'MSAA texture', size => ({
      label: 'MSAA Color Texture',
      size,
      format: preferredColorFormat(),
      dimension: '2d',
      sampleCount: samples,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }));
  }

  /**
   * Color target for offscreen mode. Acquiring the canvas swapchain destroys
   * the device where no compositor exists, so that call is skipped entirely and
   * the frame lands here instead.
   */
  private offscreenTexture(device: GPUDevice): GPUTexture {
    const canvas = this._canvas;
    if (!canvas) {
      throw new Error('[vega-webgpu] Cannot create the offscreen texture before initialization.');
    }
    return this.canvasTexture(this._offscreen, device, 'offscreen texture', size => ({
      label: 'Offscreen Color Texture',
      size,
      format: preferredColorFormat(),
      dimension: '2d',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    }));
  }

  clearColor(): GPUColor {
    if (!this._bgcolor) {
      // canvas clears to transparent and only fills when a background is set
      return { r: 0.0, g: 0.0, b: 0.0, a: 0.0 };
    }
    const [r, g, b, a] = Color.from(this._bgcolor);
    // The surface is configured alphaMode premultiplied, so a translucent
    // background has to be premultiplied here too or it composites too bright.
    return { r: r * a, g: g * a, b: b * a, a };
  }
}
