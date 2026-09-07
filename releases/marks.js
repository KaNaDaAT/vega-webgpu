/**
 * Feature playground. Builds a small spec for one mark type, applies whichever
 * of the five properties are ticked, and draws it with canvas and WebGPU side
 * by side so the difference is visible rather than described.
 *
 * SUPPORT is the single source of truth for the feature table: index.html fills
 * its matrix from here so the two cannot drift.
 */

/** yes, no, partial or na, per mark, for the five properties the table covers. */
const SUPPORT = {
  arc: { gradientFill: 'yes', gradientStroke: 'yes', strokeDash: 'no', strokeCap: 'na', blend: 'yes' },
  area: { gradientFill: 'yes', gradientStroke: 'yes', strokeDash: 'no', strokeCap: 'partial', blend: 'yes' },
  group: { gradientFill: 'yes', gradientStroke: 'no', strokeDash: 'yes', strokeCap: 'na', blend: 'no' },
  image: { gradientFill: 'na', gradientStroke: 'na', strokeDash: 'na', strokeCap: 'na', blend: 'no' },
  line: { gradientFill: 'na', gradientStroke: 'no', strokeDash: 'yes', strokeCap: 'yes', blend: 'yes' },
  path: { gradientFill: 'yes', gradientStroke: 'yes', strokeDash: 'no', strokeCap: 'partial', blend: 'yes' },
  rect: { gradientFill: 'yes', gradientStroke: 'no', strokeDash: 'no', strokeCap: 'na', blend: 'yes' },
  rule: { gradientFill: 'na', gradientStroke: 'no', strokeDash: 'no', strokeCap: 'no', blend: 'yes' },
  shape: { gradientFill: 'yes', gradientStroke: 'yes', strokeDash: 'no', strokeCap: 'partial', blend: 'yes' },
  symbol: { gradientFill: 'yes', gradientStroke: 'no', strokeDash: 'no', strokeCap: 'na', blend: 'yes' },
  text: { gradientFill: 'yes', gradientStroke: 'yes', strokeDash: 'na', strokeCap: 'na', blend: 'no' },
  trail: { gradientFill: 'yes', gradientStroke: 'yes', strokeDash: 'no', strokeCap: 'na', blend: 'yes' },
};

const MARKS = Object.keys(SUPPORT);

const FEATURES = [
  { key: 'gradientFill', label: 'Gradient fill' },
  { key: 'gradientStroke', label: 'Gradient stroke' },
  { key: 'strokeDash', label: 'strokeDash' },
  { key: 'strokeCap', label: 'strokeCap' },
  { key: 'blend', label: 'blend' },
];

const CELL_TEXT = { yes: 'yes', no: 'no', partial: 'square only', na: 'n/a' };

/** What actually happens, per property and support level, for the status line. */
const EXPLAIN = {
  gradientFill: {
    yes: 'the fill is drawn as a gradient',
    no: "ignored, the fill takes the gradient's first stop as a flat colour",
    na: 'this mark has no fill',
  },
  gradientStroke: {
    yes: 'the stroke is drawn as a gradient',
    no: "ignored, the stroke takes the gradient's first stop as a flat colour",
    na: 'this mark has no stroke',
  },
  strokeDash: {
    yes: 'the dash pattern is drawn',
    no: 'ignored, the stroke draws solid',
    na: 'this mark has no stroke',
  },
  strokeCap: {
    yes: 'round and square ends are both drawn',
    partial: 'square is drawn, round falls back to butt',
    no: 'ignored, ends draw butt',
    na: 'this mark has no open ends',
  },
  blend: {
    yes: 'the blend mode is applied',
    no: 'ignored, the mark composites normally',
    na: 'not applicable to this mark',
  },
};
const CELL_CLASS = { yes: 'y', no: 'n', partial: 'p', na: 'na' };

/** Each mark's page in the official Vega docs. */
const docsUrl = mark => `https://vega.github.io/vega/docs/marks/${mark}/`;

/**
 * Axis aligned on purpose. vega's canvas renderer routes a diagonal linear
 * gradient through createPattern with no pattern transform, so it anchors at
 * the canvas origin rather than the item and most of the shape goes unpainted.
 */
const LINEAR_GRADIENT = {
  gradient: 'linear',
  x1: 0,
  y1: 0,
  x2: 0,
  y2: 1,
  stops: [
    { offset: 0, color: '#4c78a8' },
    { offset: 0.5, color: '#72b7b2' },
    { offset: 1, color: '#e45756' },
  ],
};

const STROKE_GRADIENT = {
  gradient: 'linear',
  x1: 0,
  y1: 0,
  x2: 1,
  y2: 0,
  stops: [
    { offset: 0, color: '#e45756' },
    { offset: 1, color: '#4c78a8' },
  ],
};

const W = 360;
const H = 220;

/** Base scene per mark: enough items to overlap, so blend has something to do. */
function baseSpec(mark) {
  // An opaque background, which a chart normally has. A blend mode needs one:
  // WebGPU's fixed function blending cannot add the term that keeps a source
  // unchanged where the backdrop is empty, so multiply over nothing goes black.
  const base = {
    $schema: 'https://vega.github.io/schema/vega/v6.json',
    width: W,
    height: H,
    padding: 10,
    background: 'white',
  };
  const solid = '#4c78a8';
  const line = '#333';

  if (mark === 'arc') {
    return {
      ...base,
      data: [
        {
          name: 'd',
          values: [
            { s: 0, e: 2.4 },
            { s: 1.9, e: 4.3 },
            { s: 3.8, e: 6.2 },
          ],
        },
      ],
      marks: [
        {
          type: 'arc',
          from: { data: 'd' },
          encode: {
            update: {
              x: { value: W / 2 },
              y: { value: H / 2 },
              startAngle: { field: 's' },
              endAngle: { field: 'e' },
              innerRadius: { value: 34 },
              outerRadius: { value: 92 },
              fill: { value: solid },
              fillOpacity: { value: 0.75 },
              stroke: { value: line },
              strokeWidth: { value: 4 },
            },
          },
        },
      ],
    };
  }

  if (mark === 'area') {
    return {
      ...base,
      data: [
        {
          name: 'a',
          values: [0, 1, 2, 3, 4, 5].map(i => ({ x: 20 + i * 64, y: H - 30 - [70, 130, 60, 150, 80, 120][i] })),
        },
        {
          name: 'b',
          values: [0, 1, 2, 3, 4, 5].map(i => ({ x: 20 + i * 64, y: H - 30 - [120, 60, 140, 70, 130, 60][i] })),
        },
      ],
      marks: ['a', 'b'].map(name => ({
        type: 'area',
        from: { data: name },
        encode: {
          update: {
            x: { field: 'x' },
            y: { field: 'y' },
            y2: { value: H - 20 },
            fill: { value: name === 'a' ? solid : '#e45756' },
            fillOpacity: { value: 0.65 },
            stroke: { value: line },
            strokeWidth: { value: 4 },
          },
        },
      })),
    };
  }

  if (mark === 'group') {
    return {
      ...base,
      marks: [
        {
          type: 'group',
          encode: {
            update: {
              x: { value: 24 },
              y: { value: 24 },
              width: { value: 180 },
              height: { value: 140 },
              fill: { value: '#eef3f8' },
              stroke: { value: line },
              strokeWidth: { value: 4 },
            },
          },
          marks: [
            {
              type: 'rect',
              encode: {
                update: {
                  x: { value: 20 },
                  y: { value: 20 },
                  width: { value: 90 },
                  height: { value: 80 },
                  fill: { value: solid },
                },
              },
            },
          ],
        },
        {
          type: 'group',
          encode: {
            update: {
              x: { value: 140 },
              y: { value: 62 },
              width: { value: 180 },
              height: { value: 130 },
              fill: { value: '#e45756' },
              fillOpacity: { value: 0.6 },
              stroke: { value: line },
              strokeWidth: { value: 4 },
            },
          },
        },
      ],
    };
  }

  if (mark === 'image') {
    return {
      ...base,
      marks: [
        {
          type: 'image',
          encode: {
            update: {
              url: { value: 'https://vega.github.io/vega/data/ffox.png' },
              x: { value: 40 },
              y: { value: 30 },
              width: { value: 140 },
              height: { value: 140 },
            },
          },
        },
        {
          type: 'image',
          encode: {
            update: {
              url: { value: 'https://vega.github.io/vega/data/gimp.png' },
              x: { value: 140 },
              y: { value: 60 },
              width: { value: 140 },
              height: { value: 140 },
              opacity: { value: 0.8 },
            },
          },
        },
      ],
    };
  }

  if (mark === 'line') {
    return {
      ...base,
      data: [
        { name: 'a', values: [0, 1, 2, 3, 4, 5].map(i => ({ x: 24 + i * 62, y: 40 + [0, 90, 20, 120, 40, 100][i] })) },
        {
          name: 'b',
          values: [0, 1, 2, 3, 4, 5].map(i => ({ x: 24 + i * 62, y: 40 + [110, 30, 130, 20, 120, 40][i] })),
        },
      ],
      marks: ['a', 'b'].map(name => ({
        type: 'line',
        from: { data: name },
        encode: {
          update: {
            x: { field: 'x' },
            y: { field: 'y' },
            stroke: { value: name === 'a' ? solid : '#e45756' },
            strokeWidth: { value: 8 },
          },
        },
      })),
    };
  }

  if (mark === 'path') {
    const star = 'M0,-60 L17,-19 L60,-19 L26,7 L38,50 L0,25 L-38,50 L-26,7 L-60,-19 L-17,-19 Z';
    return {
      ...base,
      data: [
        {
          name: 'd',
          values: [
            { x: 120, y: 100 },
            { x: 240, y: 120 },
          ],
        },
      ],
      marks: [
        {
          type: 'path',
          from: { data: 'd' },
          encode: {
            update: {
              x: { field: 'x' },
              y: { field: 'y' },
              path: { value: star },
              fill: { value: solid },
              fillOpacity: { value: 0.7 },
              stroke: { value: line },
              strokeWidth: { value: 5 },
            },
          },
        },
      ],
    };
  }

  if (mark === 'rect') {
    return {
      ...base,
      data: [{ name: 'd', values: [0, 1, 2, 3].map(i => ({ x: 26 + i * 78, h: [110, 160, 80, 140][i] })) }],
      marks: [
        {
          type: 'rect',
          from: { data: 'd' },
          encode: {
            update: {
              x: { field: 'x' },
              width: { value: 62 },
              y: { signal: `${H} - 20 - datum.h` },
              y2: { value: H - 20 },
              fill: { value: solid },
              fillOpacity: { value: 0.8 },
              stroke: { value: line },
              strokeWidth: { value: 4 },
              cornerRadius: { value: 6 },
            },
          },
        },
      ],
    };
  }

  if (mark === 'rule') {
    return {
      ...base,
      data: [{ name: 'd', values: [0, 1, 2, 3].map(i => ({ i })) }],
      marks: [
        {
          type: 'rule',
          from: { data: 'd' },
          encode: {
            update: {
              x: { signal: '24 + datum.i * 30' },
              y: { value: 24 },
              x2: { signal: '120 + datum.i * 58' },
              y2: { value: H - 24 },
              stroke: { value: solid },
              strokeWidth: { value: 8 },
              strokeOpacity: { value: 0.8 },
            },
          },
        },
      ],
    };
  }

  if (mark === 'shape') {
    const poly = (cx, cy, r) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [0, 1, 2, 3, 4, 5]
            .map(i => {
              const t = (i / 6) * Math.PI * 2;
              return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
            })
            .concat([[cx + r, cy]]),
        ],
      },
    });
    return {
      ...base,
      data: [{ name: 'g', values: [poly(-14, 6, 13), poly(4, -6, 13)] }],
      projections: [{ name: 'p', type: 'mercator', scale: 340, translate: [W / 2 + 40, H / 2 - 10] }],
      marks: [
        {
          type: 'shape',
          from: { data: 'g' },
          // geoshape is a mark transform in vega, not a data one
          transform: [{ type: 'geoshape', projection: 'p' }],
          encode: {
            update: {
              fill: { value: solid },
              fillOpacity: { value: 0.7 },
              stroke: { value: line },
              strokeWidth: { value: 4 },
            },
          },
        },
      ],
    };
  }

  if (mark === 'symbol') {
    return {
      ...base,
      data: [
        {
          name: 'd',
          values: [0, 1, 2, 3, 4].map(i => ({
            x: 46 + i * 68,
            y: 70 + (i % 2) * 60,
            s: ['circle', 'square', 'diamond', 'triangle-up', 'cross'][i],
          })),
        },
      ],
      marks: [
        {
          type: 'symbol',
          from: { data: 'd' },
          encode: {
            update: {
              x: { field: 'x' },
              y: { field: 'y' },
              shape: { field: 's' },
              size: { value: 2600 },
              fill: { value: solid },
              fillOpacity: { value: 0.75 },
              stroke: { value: line },
              strokeWidth: { value: 4 },
            },
          },
        },
      ],
    };
  }

  if (mark === 'text') {
    return {
      ...base,
      data: [
        {
          name: 'd',
          values: [
            { t: 'Handgloves', y: 70 },
            { t: 'Vega WebGPU', y: 130 },
          ],
        },
      ],
      marks: [
        {
          type: 'text',
          from: { data: 'd' },
          encode: {
            update: {
              x: { value: 24 },
              y: { field: 'y' },
              text: { field: 't' },
              fontSize: { value: 34 },
              font: { value: 'sans-serif' },
              fill: { value: solid },
              stroke: { value: line },
              strokeWidth: { value: 1 },
            },
          },
        },
      ],
    };
  }

  // trail
  return {
    ...base,
    data: [
      {
        name: 'a',
        values: [0, 1, 2, 3, 4, 5, 6].map(i => ({ x: 24 + i * 52, y: 70 + Math.sin(i) * 34, w: 4 + i * 4 })),
      },
      {
        name: 'b',
        values: [0, 1, 2, 3, 4, 5, 6].map(i => ({ x: 24 + i * 52, y: 150 - Math.sin(i) * 34, w: 30 - i * 4 })),
      },
    ],
    marks: ['a', 'b'].map(name => ({
      type: 'trail',
      from: { data: name },
      encode: {
        update: {
          x: { field: 'x' },
          y: { field: 'y' },
          size: { field: 'w' },
          fill: { value: name === 'a' ? solid : '#e45756' },
          fillOpacity: { value: 0.8 },
        },
      },
    })),
  };
}

/** Walks every mark's update encoding, including nested group children. */
function eachEncoding(marks, fn) {
  for (const m of marks ?? []) {
    if (m.encode?.update) {
      fn(m.encode.update, m.type);
    }
    eachEncoding(m.marks, fn);
  }
}

/** Applies the ticked properties on top of the base scene. */
function applyFeatures(spec, on) {
  eachEncoding(spec.marks, (enc, type) => {
    if (on.gradientFill && enc.fill && type !== 'image') {
      enc.fill = { value: LINEAR_GRADIENT };
    }
    if (on.gradientStroke && enc.stroke) {
      enc.stroke = { value: STROKE_GRADIENT };
    }
    if (on.strokeDash && enc.stroke) {
      enc.strokeDash = { value: [10, 6] };
    }
    if (on.strokeCap && enc.stroke) {
      enc.strokeCap = { value: 'round' };
      enc.strokeJoin = { value: 'round' };
    }
    if (on.blend) {
      enc.blend = { value: 'multiply' };
    }
  });
  return spec;
}

export { SUPPORT, MARKS, FEATURES, CELL_TEXT, CELL_CLASS, EXPLAIN, docsUrl, baseSpec, applyFeatures, W, H };
