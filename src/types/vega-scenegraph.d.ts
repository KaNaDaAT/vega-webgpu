/**
 * Type declarations for the vega-scenegraph API surface used by this package.
 * vega-scenegraph 5.x ships no bundled types, so these declarations are written
 * against its source (see node_modules/vega-scenegraph/src).
 */
declare module 'vega-scenegraph' {
  import type { CurveFactory, SymbolType } from 'd3-shape';

  export class Bounds {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    clone(): Bounds;
    clear(): this;
    empty(): boolean;
    equals(b: Bounds): boolean;
    set(x1: number, y1: number, x2: number, y2: number): this;
    add(x: number, y: number): this;
    expand(d: number): this;
    round(): this;
    scale(s: number): this;
    translate(dx: number, dy: number): this;
    rotate(angle: number, x: number, y: number): this;
    union(b: Bounds): this;
    intersect(b: Bounds): this;
    encloses(b: Bounds): boolean;
    alignsWith(b: Bounds): boolean;
    intersects(b: Bounds): boolean;
    contains(x: number, y: number): boolean;
    width(): number;
    height(): number;
  }

  /**
   * Base class for renderers. Subclasses override `_render` (not `render`)
   * and typically `initialize`, `resize` and `dirty`.
   */
  export class Renderer {
    constructor(loader?: unknown);
    _el: HTMLElement | null;
    _bgcolor: string | null;
    _width: number;
    _height: number;
    _origin: readonly [number, number];
    _scale: number;
    initialize(
      el: HTMLElement | null,
      width: number,
      height: number,
      origin: readonly number[],
      scaleFactor?: number,
      opt?: unknown,
    ): this;
    element(): HTMLElement | null;
    canvas(): HTMLCanvasElement | null;
    background(bgcolor?: string): string | this;
    resize(width: number, height: number, origin: readonly number[], scaleFactor?: number): this;
    dirty(item: unknown): void;
    render(scene: unknown, markTypes?: string[]): this;
    _render(scene: unknown, markTypes?: string[]): void;
    renderAsync(scene: unknown, markTypes?: string[]): Promise<this>;
    /** Cached render invocation used to redraw after async resource loads. */
    _call: (() => void) | null;
    /** Resolves once all pending resource loads (and their re-render) settle. */
    _ready: Promise<unknown> | null;
    sanitizeURL(uri: string): Promise<unknown>;
    loadImage(uri: string): Promise<unknown>;
  }

  export class Handler {
    constructor(customLoader?: unknown, customTooltip?: unknown);
  }

  export class CanvasHandler extends Handler {
    _canvas: HTMLCanvasElement & { _pickCanvas?: HTMLCanvasElement };
    context(): CanvasRenderingContext2D | null;
    canvas(): HTMLCanvasElement;
  }

  export class CanvasRenderer extends Renderer {}
  export class SVGRenderer extends Renderer {}

  export interface RenderModule {
    renderer: typeof Renderer;
    headless?: typeof Renderer;
    handler: typeof Handler;
  }
  export function renderModule(name: string): RenderModule | undefined;
  export function renderModule(name: string, module: RenderModule): unknown;

  /** Mark draw/bound/pick implementations of the canvas renderer, keyed by mark type. */
  export const Marks: Record<
    string,
    {
      type: string;
      draw: (context: CanvasRenderingContext2D, scene: unknown, bounds: Bounds | null) => void;
      bound: (bounds: Bounds, item: unknown, mode?: number) => Bounds;
      pick?: (...args: unknown[]) => unknown;
    }
  >;

  export function domClear(el: Element, index: number): Element;
  export function domCreate(doc: Document | null, tag: string, ns?: string): Element;

  export function pathCurves(interpolate: string, orientation?: string, tension?: number): CurveFactory;
  export function pathSymbols(shape: string | SymbolType): SymbolType;

  /** Chainable path generator in the style of d3-shape (see src/path/rectangle.js). */
  export interface RectanglePathGenerator<T> {
    (item: T, x?: number, y?: number): string | null | undefined;
    context(ctx: CanvasRenderingContext2D | null): this;
    x(f: number | ((item: T) => number)): this;
    y(f: number | ((item: T) => number)): this;
    width(f: number | ((item: T) => number)): this;
    height(f: number | ((item: T) => number)): this;
    cornerRadius(f: number | ((item: T) => number)): this;
  }
  export function pathRectangle<T = unknown>(): RectanglePathGenerator<T>;

  /** Chainable trail generator (see src/path/trail.js). */
  export interface TrailPathGenerator<T> {
    (items: T[]): string | null | undefined;
    context(ctx: CanvasRenderingContext2D | null): this;
    x(f: number | ((item: T) => number)): this;
    y(f: number | ((item: T) => number)): this;
    size(f: number | ((item: T) => number)): this;
    defined(f: boolean | ((item: T) => boolean)): this;
  }
  export function pathTrail<T = unknown>(): TrailPathGenerator<T>;

  export function sceneFromJSON(json: string | object): unknown;
  export function sceneToJSON(scene: unknown, indent?: number): string;
}
