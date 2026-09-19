import { trail } from '../path/shapes.js';
import { oneShapeMark } from './oneShape.js';

export default oneShapeMark({ type: 'trail', name: 'Trail', shapeOf: trail, maskOutline: true });
