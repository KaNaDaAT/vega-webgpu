import type { GlyphMetrics } from './textTexture.js';

/** Placement of one rasterized label inside the atlas, in device pixels. */
export interface GlyphSlot extends GlyphMetrics {
  x: number;
  y: number;
}

/** Transparent gap between packed labels, so filtering cannot reach a neighbour. */
const PAD = 1;
const INITIAL_SIZE = 512;
const MAX_SIZE = 2048;

/**
 * Packs the labels of a frame into one canvas and uploads them in a single
 * copy. `copyExternalImageToTexture` costs about 1.2 ms whenever its source
 * canvas changed since the last copy, regardless of the region size, so a
 * texture per label made a rotating radial tree spend 250 ms a frame in the
 * driver.
 *
 * Slots survive across frames. Growing or clearing mints a new texture, and the
 * one it replaces stays alive until the frame is submitted, so only the batch
 * currently being packed (which shares one bind group) has to be protected.
 */
export class TextAtlas {
  private readonly _max: number;
  private readonly _canvas: HTMLCanvasElement;
  private readonly _c2d: CanvasRenderingContext2D;
  private readonly _slots = new Map<string, GlyphSlot>();
  private _texture!: GPUTexture;
  private _size = 0;
  private _shelfY = 0;
  private _shelfHeight = 0;
  private _cursorX = 0;
  private _dirty: [x0: number, y0: number, x1: number, y1: number] | null = null;
  private _spilled = false;
  private _batchArea = 0;
  private _lastBatchArea = 0;

  /** Called with a texture the atlas has replaced, which a queued draw may still hold. */
  onRelease: ((texture: GPUTexture) => void) | null = null;

  constructor(private readonly _device: GPUDevice) {
    this._max = Math.min(MAX_SIZE, _device.limits.maxTextureDimension2D);
    this._canvas = document.createElement('canvas');
    this._c2d = this._canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    this._reset(Math.min(INITIAL_SIZE, this._max));
  }

  get context(): CanvasRenderingContext2D {
    return this._c2d;
  }

  get texture(): GPUTexture {
    return this._texture;
  }

  get size(): number {
    return this._size;
  }

  /**
   * Starts a batch of lookups that will share one bind group, growing or
   * clearing the atlas first if the last batch of this size would not fit in
   * what is left. Nothing else replaces the texture, so a batch always packs
   * into the one it read.
   */
  begin(): void {
    this._lastBatchArea = this._batchArea;
    this._batchArea = 0;
    const free = Math.max(0, this._size - this._shelfY - this._shelfHeight) * this._size;
    if (!this._spilled && free >= this._lastBatchArea) {
      return;
    }
    this._reset(this._size < this._max ? Math.min(this._size * 2, this._max) : this._size);
  }

  /** Slot for a label already packed. */
  find(key: string): GlyphSlot | undefined {
    return this._slots.get(key);
  }

  /**
   * Reserves space for a label. Returns null when it does not fit, and the
   * caller falls back to a texture of its own.
   */
  alloc(key: string, metrics: GlyphMetrics): GlyphSlot | null {
    const { physWidth: w, physHeight: h } = metrics;
    const placed = this._place(w, h);
    if (!placed) {
      this._spilled = true;
      return null;
    }
    this._batchArea += w * h;
    const slot: GlyphSlot = { ...metrics, x: placed[0], y: placed[1] };
    this._slots.set(key, slot);
    this._markDirty(slot.x, slot.y, slot.x + w, slot.y + h);
    return slot;
  }

  /** Uploads whatever was drawn since the last flush. */
  flush(): void {
    const dirty = this._dirty;
    if (!dirty) {
      return;
    }
    this._dirty = null;
    const [x0, y0, x1, y1] = dirty;
    this._device.queue.copyExternalImageToTexture(
      { source: this._canvas, origin: [x0, y0] },
      { texture: this._texture, origin: [x0, y0], premultipliedAlpha: true },
      [x1 - x0, y1 - y0],
    );
  }

  destroy(): void {
    this._texture.destroy();
    this._slots.clear();
  }

  private _place(w: number, h: number): [x: number, y: number] | null {
    if (w + PAD > this._size || h + PAD > this._size) {
      return null;
    }
    if (this._cursorX + w + PAD > this._size) {
      this._shelfY += this._shelfHeight + PAD;
      this._shelfHeight = 0;
      this._cursorX = 0;
    }
    if (this._shelfY + h + PAD > this._size) {
      return null;
    }
    const x = this._cursorX;
    const y = this._shelfY;
    this._cursorX += w + PAD;
    this._shelfHeight = Math.max(this._shelfHeight, h);
    return [x, y];
  }

  private _reset(size: number): void {
    const first = this._size === 0;
    if (size !== this._size) {
      this._size = size;
      this._canvas.width = size;
      this._canvas.height = size;
    } else {
      this._c2d.setTransform(1, 0, 0, 1, 0, 0);
      this._c2d.clearRect(0, 0, size, size);
    }
    if (!first) {
      const old = this._texture;
      if (this.onRelease) {
        this.onRelease(old);
      } else {
        old.destroy();
      }
    }
    this._slots.clear();
    this._shelfY = 0;
    this._shelfHeight = 0;
    this._cursorX = 0;
    this._dirty = null;
    this._spilled = false;
    this._texture = this._device.createTexture({
      label: 'Text Atlas',
      size: [size, size, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private _markDirty(x0: number, y0: number, x1: number, y1: number): void {
    if (!this._dirty) {
      this._dirty = [x0, y0, x1, y1];
      return;
    }
    this._dirty[0] = Math.min(this._dirty[0], x0);
    this._dirty[1] = Math.min(this._dirty[1], y0);
    this._dirty[2] = Math.max(this._dirty[2], x1);
    this._dirty[3] = Math.max(this._dirty[3], y1);
  }
}
