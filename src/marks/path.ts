import type { ScenePathItem } from '../types/scene.js';
import geometryForPath from '../path/geometryForPath.js';
import { itemShapeMark } from './itemShape.js';

const DEG_TO_RAD = Math.PI / 180;

export default itemShapeMark<ScenePathItem>({
  type: 'path',
  name: 'Path',
  shapeOf: (ctx, item, scale) => geometryForPath(ctx, item.path, scale),
  transformOf: item => ({
    angle: (item.angle || 0) * DEG_TO_RAD,
    scaleX: item.scaleX ?? 1,
    scaleY: item.scaleY ?? 1,
  }),
  cached: true,
});
