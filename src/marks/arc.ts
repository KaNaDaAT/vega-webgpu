import type { SceneArcItem } from '../types/scene.js';
import { arc } from '../path/shapes.js';
import { itemShapeMark } from './itemShape.js';

export default itemShapeMark<SceneArcItem>({ type: 'arc', name: 'Arc', shapeOf: arc });
