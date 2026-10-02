import type { ScenePathItem } from '../types/scene.js';
import geometryForPath from '../path/geometryForPath.js';
import { itemTurn } from '../path/geometryForItem.js';
import { itemShapeMark } from './itemShape.js';

export default itemShapeMark<ScenePathItem>({
  type: 'path',
  name: 'Path',
  // vega scales the path commands inside pathRender and rotates the context
  // around them, so the scale belongs to the geometry rather than to the
  // transform applied after it. That matters for an elliptical arc: vega
  // scales rx and ry and leaves the x axis rotation alone, which is a
  // different ellipse from the affine scale of the flattened curve.
  shapeOf: (ctx, item, scale) => geometryForPath(ctx, item.path, scale, item.scaleX ?? 1, item.scaleY ?? 1),
  transformOf: item => ({
    angle: itemTurn(item),
    scaleX: 1,
    scaleY: 1,
  }),
  cached: true,
});
