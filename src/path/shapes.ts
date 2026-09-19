import { arc as d3_arc, area as d3_area, line as d3_line, symbol as d3_symbol, type SymbolType } from 'd3-shape';
import { pathCurves, pathSymbols, pathTrail } from 'vega-scenegraph';
import type { GPUVegaCanvasContext } from '../types/context.js';
import type { PathGeometry } from '../types/geometry.js';
import type { SceneArcItem, SceneAreaItem, SceneShapeItem } from '../types/scene.js';
import geometryForPath from './geometryForPath.js';

type AreaPoint = SceneAreaItem;

/** vega shape instances are d3-style generators with a context setter. */
interface ShapeGenerator {
  (item: SceneShapeItem): string | null | undefined;
  context(ctx: CanvasRenderingContext2D | null): ShapeGenerator;
}

const x = (item: AreaPoint) => item.x || 0;
const y = (item: AreaPoint) => item.y || 0;
const xw = (item: AreaPoint) => (item.x || 0) + (item.width || 0);
const yh = (item: AreaPoint) => (item.y || 0) + (item.height || 0);
// vega's own trail accessor, which is `size` and not the item's extent
const ts = (item: AreaPoint) => item.size || 1;
const cr = (item: SceneArcItem) => item.cornerRadius || 0;
const pa = (item: SceneArcItem) => item.padAngle || 0;
const def = (item: AreaPoint) => item.defined !== false;

// Every accessor, the way vega's own generator sets them. d3 defaults these to
// fields on the datum, and vega puts no defaults on a scenegraph item, so an
// arc that does not encode innerRadius reached d3 with it undefined: the
// closing point came out NaN and cornerRadius went with it.
const arcShape = d3_arc<SceneArcItem>()
  .startAngle(item => item.startAngle || 0)
  .endAngle(item => item.endAngle || 0)
  .innerRadius(item => item.innerRadius || 0)
  .outerRadius(item => item.outerRadius || 0)
  .cornerRadius(cr)
  .padAngle(pa);
const areavShape = d3_area<AreaPoint>().x(x).y1(y).y0(yh).defined(def);
const areahShape = d3_area<AreaPoint>().y(y).x1(x).x0(xw).defined(def);
const trailShape = pathTrail<AreaPoint>().x(x).y(y).defined(def).size(ts);
const lineShape = d3_line<AreaPoint>().x(x).y(y).defined(def);

export function arc(context: GPUVegaCanvasContext, item: SceneArcItem, scale?: number): PathGeometry {
  return geometryForPath(context, arcShape.context(null)(item) ?? '', scale);
}

export function area(context: GPUVegaCanvasContext, items: AreaPoint[], scale?: number): PathGeometry {
  const item = items[0];
  const interp = item.interpolate || 'linear';
  if (interp === 'trail') {
    return trail(context, items, scale);
  }
  const path = (item.orient === 'horizontal' ? areahShape : areavShape)
    .curve(pathCurves(interp, item.orient, item.tension))
    .context(null)(items);
  return geometryForPath(context, path ?? '', scale);
}

/**
 * Path geometry for a trail mark: one filled ribbon whose width follows each
 * point's `size`, which is what vega's own trail mark draws.
 */
export function trail(context: GPUVegaCanvasContext, items: AreaPoint[], scale?: number): PathGeometry {
  return geometryForPath(context, trailShape.context(null)(items) ?? '', scale);
}

/**
 * Path geometry for a line mark, honouring `interpolate`, `tension` and the
 * `defined` gaps. Used when the line is not a plain polyline.
 */
export function line(context: GPUVegaCanvasContext, items: AreaPoint[]): PathGeometry {
  const item = items[0];
  const curve = pathCurves(item.interpolate || 'linear', item.orient, item.tension);
  return geometryForPath(context, lineShape.curve(curve).context(null)(items) ?? '');
}

/** The path calls d3's generators make, for a consumer that is not a canvas. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  closePath(): void;
}

/**
 * Runs the line generator straight into `sink`, so a caller that wants the
 * curve's own control points gets them without a path string in between.
 */
export function lineSpans(items: AreaPoint[], sink: PathSink): void {
  const item = items[0];
  const curve = pathCurves(item.interpolate || 'linear', item.orient, item.tension);
  lineShape.curve(curve).context(sink as unknown as CanvasRenderingContext2D)(items);
  lineShape.context(null);
}

export function shape(context: GPUVegaCanvasContext, item: SceneShapeItem, scale?: number): PathGeometry {
  const generator = ((item.mark as { shape?: unknown }).shape ?? item.shape) as ShapeGenerator;
  return geometryForPath(context, generator.context(null)(item) ?? '', scale);
}

/**
 * Triangulated geometry for a vega symbol shape (square, cross, diamond,
 * triangle-*, arrow, wedge, stroke, or a custom SVG path) at the given size,
 * centered on the origin. `size` is the symbol area, matching the canvas
 * renderer's `pathSymbols` sizing.
 */
export function symbol(context: GPUVegaCanvasContext, shapeName: string, size: number, scale?: number): PathGeometry {
  const type = pathSymbols(shapeName || 'circle') as unknown as SymbolType;
  const path = d3_symbol(type, size).context(null)() ?? '';
  return geometryForPath(context, path, scale);
}
