import arc from './arc.js';
import area from './area.js';
import group from './group.js';
import image from './image.js';
import line from './line.js';
import path from './path.js';
import rect from './rect.js';
import rule from './rule.js';
import shape from './shape.js';
import symbol from './symbol.js';
import text from './text.js';
import type { MarkModule } from './util.js';

const marks: Record<string, MarkModule> = {
  arc,
  area,
  group,
  image,
  line,
  path,
  rect,
  rule,
  shape,
  symbol,
  text,
};

export default marks;
