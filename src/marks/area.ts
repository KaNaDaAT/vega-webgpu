import { area } from '../path/shapes.js';
import { oneShapeMark } from './oneShape.js';

export default oneShapeMark({ type: 'area', name: 'Area', shapeOf: area, maskOutline: false });
