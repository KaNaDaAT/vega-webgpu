/**
 * Regenerates the `*-variants` fixtures: one per mark, holding every paint the
 * mark takes crossed with every way its stroke can be drawn.
 *
 * One property at a time is what let a rect with a gradient fill and a walked
 * border draw its fill in the placeholder colour for as long as it did, so the
 * grid exists to cover the pairs rather than the singles. Run it after
 * changing the matrix below, then re-measure the budgets in scenes.ts.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './paths.mjs';

const scenes = join(root, 'test', 'render', 'scenes');

const FILL = {
  gradient: 'linear', x1: 0, y1: 0, x2: 0, y2: 1,
  stops: [{ offset: 0, color: '#4c78a8' }, { offset: 0.5, color: '#72b7b2' }, { offset: 1, color: '#e45756' }],
};
const SGRAD = {
  gradient: 'linear', x1: 0, y1: 0, x2: 1, y2: 0,
  stops: [{ offset: 0, color: '#e45756' }, { offset: 1, color: '#4c78a8' }],
};
const SOLID_F = '#9ecae9';
const SOLID_S = '#2b5d8a';

const FILLS = [SOLID_F, FILL];
const STROKES = [
  {},
  { stroke: SOLID_S, strokeWidth: 4 },
  { stroke: SGRAD, strokeWidth: 4 },
  { stroke: SOLID_S, strokeWidth: 4, strokeDash: [9, 7] },
  { stroke: SGRAD, strokeWidth: 4, strokeDash: [9, 7] },
  { stroke: SOLID_S, strokeWidth: 5, strokeDash: [11, 9], strokeCap: 'square', strokeJoin: 'bevel' },
];

const CELL_W = 108;
const CELL_H = 92;
const cell = (i, j) => [16 + j * CELL_W, 16 + i * CELL_H];
const size = (rows, cols) => [32 + cols * CELL_W, 32 + rows * CELL_H];
const mark = (marktype, items) => ({ marktype, role: 'mark', interactive: true, clip: false, items });

const COLUMNS = 'no stroke, a solid one, a ramp, a dash, a dashed ramp, and a dashed square cap';
const WHY =
  'One property at a time is what let a rect with a gradient fill and a walked border go wrong unseen.';

/**
 * Writes one grid. `lead` says what the grid holds, and defaults to the two
 * fill rows against the six stroke columns. Three of the marks do not have
 * that shape and pass their own, because a description that claims a row or a
 * column the fixture does not draw is a fixture nobody can check against.
 * `note` is anything one cell needs said, which the gallery shows with it.
 */
function write(name, rows, marks, what, lead, note) {
  const [width, height] = size(rows, STROKES.length);
  const says =
    lead ??
    `Every paint ${what} takes crossed with every way its stroke can draw: solid and gradient fills against ${COLUMNS}.`;
  const doc = {
    description: [says, note, WHY].filter(Boolean).join(' '),
    width, height, origin: [0, 0],
    scene: {
      marktype: 'group', name: 'root', role: 'frame', interactive: true, clip: false,
      items: [{ items: marks }],
    },
  };
  writeFileSync(join(scenes, `${name}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`wrote ${name} ${width}x${height}`);
}

/** A mark drawn one item per cell. */
function perItem(type, build, fills = FILLS, lead, note) {
  const items = [];
  fills.forEach((fill, i) =>
    STROKES.forEach((stroke, j) => {
      const [x, y] = cell(i, j);
      items.push(build(x, y, fill, stroke));
    }),
  );
  write(`${type}-variants`, fills.length, [mark(type, items)], type, lead, note);
}

/** A mark whose items are one shape, so one mark instance per cell. */
function perMark(type, points, fills = FILLS, lead) {
  const marks = [];
  fills.forEach((fill, i) =>
    STROKES.forEach((stroke, j) => {
      const [x, y] = cell(i, j);
      marks.push(mark(type, points(x, y, fill, stroke)));
    }),
  );
  write(`${type}-variants`, fills.length, marks, type, lead);
}

perItem('arc', (x, y, fill, s) => ({
  x: x + 44, y: y + 42, startAngle: 0.4, endAngle: 5.1, innerRadius: 14, outerRadius: 36, fill, ...s,
}));
perItem('rect', (x, y, fill, s) => ({
  x: x + 12, y: y + 12, width: 70, height: 58, cornerRadius: 6, fill, ...s,
}));
perItem(
  'symbol',
  (x, y, fill, s) => ({ x: x + 44, y: y + 42, size: 1800, shape: 'square', fill, ...s }),
  FILLS,
  undefined,
  'In the last column a dash runs across the top left corner, where the square starts and closes. ' +
    'Canvas on a GPU bevels it as it does any join inside a dash, and so does this renderer. Canvas ' +
    'on the CPU, which records the hosted gallery, fills that corner in with these square caps, ' +
    'though it bevels it with butt caps.',
);
perItem('path', (x, y, fill, s) => ({
  x: x + 10, y: y + 12, path: 'M0,56 L22,8 L44,56 L66,8 L86,56 Z', fill, ...s,
}));
// A label is rasterized by vega's own text mark, so it dashes a stroke like
// any other. The dash columns were dropped here once, which made four of the
// twelve cells a copy of another four and hid a glyph cache key that left the
// dash, the cap and the join out of it.
perItem('text', (x, y, fill, s) => ({
  x: x + 10, y: y + 56, text: 'Ag', font: 'sans-serif', fontSize: 16, fill, ...s,
}));

const span = (n, f) => Array.from({ length: n }, (_, k) => f(k));
perMark('area', (x, y, fill, s) =>
  span(5, k => {
    const h = 14 + 34 * Math.abs(Math.sin(k / 1.7));
    return { x: x + 10 + k * 17, y: y + 66 - h, height: h, fill, ...s };
  }),
);
perMark('trail', (x, y, fill, s) =>
  span(5, k => ({ x: x + 10 + k * 17, y: y + 44 + 18 * Math.sin(k / 1.3), size: 3 + 1.8 * k, fill, ...s })),
);
perMark(
  'line',
  (x, y, fill, s) =>
    span(5, k => ({
      x: x + 10 + k * 17,
      y: y + 44 + 22 * Math.sin(k / 1.1),
      interpolate: 'linear',
      ...(Object.keys(s).length ? s : { stroke: SOLID_S, strokeWidth: 4 }),
    })),
  [SOLID_F],
  'Every way a line can draw its stroke: a solid one, a ramp, a dash, a dashed ramp, and a ' +
    'dashed square cap. A line takes no fill, so there is no paint to cross the columns with, ' +
    'and one with no stroke draws nothing, so the first column repeats the solid one.',
);

// rule has no fill, so its grid is the stroke kinds at two angles
const rules = [];
[[84, 0], [72, 52]].forEach(([dx, dy], i) =>
  STROKES.forEach((s, j) => {
    if (!Object.keys(s).length) return;
    const [x, y] = cell(i, j);
    rules.push({ x: x + 12, y: y + 20, x2: x + 12 + dx, y2: y + 20 + dy, ...s });
  }),
);
write(
  'rule-variants',
  2,
  [mark('rule', rules)],
  'rule',
  'Every way a rule can draw its stroke, axis aligned on the top row and diagonal below: a ' +
    'solid one, a ramp, a dash, a dashed ramp, and a dashed square cap. A rule takes no fill ' +
    'and cannot draw with no stroke, so the first column is empty.',
);

// Solid fill only, for the reason the description gives.
const groups = [];
STROKES.forEach((s, j) => {
  const [x, y] = cell(0, j);
  groups.push({ x: x + 10, y: y + 10, width: 76, height: 64, cornerRadius: 5, fill: SOLID_F, ...s, items: [] });
});
write(
  'group-variants',
  1,
  [mark('group', groups)],
  'group',
  'Every way a group border can draw, over a solid fill: no stroke, a solid one, a ramp, a ' +
    'dash, a dashed ramp, and a dashed square cap. There is no gradient fill row, because ' +
    'boundMark inflates a group item\'s bounds in a serialized scenegraph and canvas maps a ' +
    'ramp onto those, so the row would compare two different boxes rather than two renderers.',
);
