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
const wh = (item: AreaPoint) => item.width || item.height || 1;
const cr = (item: SceneArcItem) => item.cornerRadius || 0;
const pa = (item: SceneArcItem) => item.padAngle || 0;
const def = (item: AreaPoint) => item.defined !== false;

const arcShape = d3_arc<SceneArcItem>().cornerRadius(cr).padAngle(pa);
const areavShape = d3_area<AreaPoint>().x(x).y1(y).y0(yh).defined(def);
const areahShape = d3_area<AreaPoint>().y(y).x1(x).x0(xw).defined(def);
const trailShape = pathTrail<AreaPoint>().x(x).y(y).defined(def).size(wh);
const lineShape = d3_line<AreaPoint>().x(x).y(y).defined(def);

export function arc(context: GPUVegaCanvasContext, item: SceneArcItem): PathGeometry {
  return geometryForPath(context, arcShape.context(null)(item) ?? '', 0.1);
}

export function area(context: GPUVegaCanvasContext, items: AreaPoint[]): PathGeometry {
  const item = items[0];
  const interp = item.interpolate || 'linear';
  const path =
    interp === 'trail'
      ? trailShape.context(null)(items)
      : (item.orient === 'horizontal' ? areahShape : areavShape)
          .curve(pathCurves(interp, item.orient, item.tension))
          .context(null)(items);
  return geometryForPath(context, path ?? '', 0.1);
}

/**
 * Path geometry for a line mark, honouring `interpolate`, `tension` and the
 * `defined` gaps. Used when the line is not a plain polyline.
 */
export function line(context: GPUVegaCanvasContext, items: AreaPoint[]): PathGeometry {
  const item = items[0];
  const curve = pathCurves(item.interpolate || 'linear', item.orient, item.tension);
  return geometryForPath(context, lineShape.curve(curve).context(null)(items) ?? '', 0.1);
}

export function shape(context: GPUVegaCanvasContext, item: SceneShapeItem): PathGeometry {
  const generator = ((item.mark as { shape?: unknown }).shape ?? item.shape) as ShapeGenerator;
  return geometryForPath(context, generator.context(null)(item) ?? '', 0.1);
}

/**
 * Triangulated geometry for a vega symbol shape (square, cross, diamond,
 * triangle-*, arrow, wedge, stroke, or a custom SVG path) at the given size,
 * centered on the origin. `size` is the symbol area, matching the canvas
 * renderer's `pathSymbols` sizing.
 */
export function symbol(context: GPUVegaCanvasContext, shapeName: string, size: number): PathGeometry {
  const type = pathSymbols(shapeName || 'circle') as unknown as SymbolType;
  const path = d3_symbol(type, size).context(null)() ?? '';
  return geometryForPath(context, path, 0.1);
}
