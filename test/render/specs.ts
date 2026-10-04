import { specNames } from '../../scripts/specs-manifest.mjs';
import '../measures.js';

/**
 * Specs that cannot be compared deterministically offline, with the reason.
 * Everything else in test/specs-valid is tested automatically (see below), so
 * new specs are picked up without editing a list.
 */
export const excludedSpecs: Record<string, string> = {
  'dynamic-url': 'loads data from a signal-driven remote URL at runtime',
  'dynamic-format': 'loads data from a signal-driven remote URL at runtime',
  'overview-detail-bins': 'loads data from a remote URL',
  wordcloud: 'excluded by vega itself, cross-platform text-layout variance',
  'force-beeswarm': 'force layout settles over many frames (non-deterministic)',
  'force-network': 'force layout settles over many frames (non-deterministic)',
  benchmark: 'signal-driven stress demo (up to 300k points)',
  'earthquakes-globe': 'a timer rotates the globe, so the captured frame depends on wall clock',
  'splom-outer-50k': '50k-point stress demo, too slow for software-rendered CI',
  'movies-sort':
    'a 47678px tall canvas, past the GPU texture cap, so the renderer draws it at a ' +
    'reduced ratio and the two images are no longer the same size to compare',
};

/**
 * Every spec in test/specs-valid (minus the documented exclusions) is rendered
 * with both the WebGPU and canvas renderers and compared directly. There are
 * no stored image baselines, and the canvas renderer is the ground truth.
 * Mark-level geometry is covered separately by the scenegraph fixtures in
 * test/render/scenes (see scenes.ts).
 *
 * The list comes from specNames() rather than the directory, so a spec taken
 * off the demo page through test/specs-ignore.json leaves here too.
 */
export const renderSpecs: string[] = specNames().filter(s => !(s in excludedSpecs));

/** One comparison: a spec, and any renderer options it is rendered under. */
export interface SpecCase {
  /** What the budgets, the gallery and the artifacts are keyed by. */
  name: string;
  spec: string;
  query: string;
}

/**
 * Specs rendered a second time with a renderer option set, beside the plain
 * one, so both readings are gated rather than one being argued about.
 *
 * `canvasTextDrift` is the only one so far. Canvas rounds a text baseline to a
 * whole device pixel and its own matrix has usually drifted just below the
 * half, so a label landing on exactly .5 goes a whole row the other way. The
 * option reproduces that drift, which is another renderer's rounding error, so
 * it is off by default and the plain case carries what that costs.
 */
export const specVariants: SpecCase[] = [{ name: 'label-drift', spec: 'label', query: '&canvasTextDrift=1' }];

/** Every comparison the suite runs, plain specs first. */
export const specCases: SpecCase[] = [...renderSpecs.map(spec => ({ name: spec, spec, query: '' })), ...specVariants];

/**
 * Densest 32px square of difference a spec may have, as a fraction of that
 * square. The whole-image percentage is diluted by however much of a spec is
 * empty or flat, so a small region that is badly wrong reads like a faint haze
 * over everything. The worst gated case is `map-fit` at 23.7%, so this only
 * catches a gross localized failure the percentage would hide, and needs no
 * per-spec list.
 */
export const TILE_CHECK_DEFAULT = 0.35;

/**
 * Fraction of differing pixels allowed by default. Antialiased pixels are
 * counted (see compare.ts), so these budgets cover the whole difference rather
 * than the part pixelmatch does not classify as antialiasing. Most specs
 * measure under 0.4%, so this is tight enough that a real regression fails
 * rather than hiding inside the budget. Every spec that needs more is listed
 * below with the reason, which keeps the exceptions visible instead of
 * blanket-loose.
 */
export const CROSS_CHECK_DEFAULT = 0.008;

/**
 * Mean channel error allowed over the inked pixels of a spec.
 *
 * The differing-pixel budget cannot see a small error spread over everything:
 * pixelmatch ignores anything under its colour threshold, measured at 39 levels
 * on every channel or 60 on one, so a render that is uniformly too dark or
 * carries a colour cast scores a flat 0%. This is the number that catches that.
 *
 * It is an average rather than a worst pixel on purpose. A worst pixel reads
 * 255 the moment one antialiased edge lands on the other side of a rounding
 * boundary, which happens across the corpus for reasons nobody can see, so
 * gating on it would mean a per-spec table of numbers that mean nothing. Fifty
 * edge pixels 100 levels apart move a mean by a hundredth. The same 100 levels
 * over a whole mark moves it by 100.
 *
 * So this is deliberately loose. The gap it covers runs from here to 39, where
 * the pixel count takes over, and the errors it exists to catch (a wrong colour
 * space, a missing premultiply, a blend factor the wrong way round) all land in
 * the tens. Tightening it below 10 would mean an entry for a third of the
 * corpus, since text and geography already sit at 5 to 8 for known reasons.
 * `CROSS_REPORT=1 npx playwright test` prints every measurement.
 */
export const MEAN_DELTA_DEFAULT = 10;

/**
 * The same average, taken only over inked pixels whose 3x3 neighbourhood is
 * flat in both renders.
 *
 * Dropping the edges drops the reason the budget above has to be loose. What is
 * left is mark interiors, where the two rasterizers agree to within rounding,
 * so this holds a far tighter number: over the corpus the worst is 1.55 against
 * a mean of up to 13.09, and it catches a 5 level colour error where the mean
 * needs about 12.
 *
 * It does not apply everywhere, which is what the sample floor is for. Chart
 * ink is mostly edges: text and thin lines have no flat interior at all, and 37
 * of the 191 gated pairs cannot fill the sample at dpr 1, so those keep the
 * mean alone. A finer grid splits the same marks into more pixels and only 10
 * fall short at dpr 2. This is Skia Gold's Sobel matcher in miniature, which
 * masks edges before diffing for the same reason.
 */
export const FLAT_MEAN_DEFAULT = 3;

/**
 * Mean *signed* channel error allowed over the inked pixels of a spec. The
 * unsigned mean above cannot see a small systematic error on anything made of
 * edges, because legitimate antialiasing differences there are larger than it:
 * text and thin lines sit at a floor of about 12 levels. A systematic error
 * shifts every pixel the same way and a coverage difference does not, so the
 * signed mean separates them, and 145 of the 191 gated cases sit under 0.5 of a
 * level on it.
 *
 * What is over it is known and listed below. Two populations: the polygon seam
 * model, where canvas leaves a pale line on a shared edge and one multisampled
 * pass cannot, and sparse specs whose inked pixels are nearly all edge, so
 * coverage is the average rather than a correction to it.
 */
export const BIAS_DELTA_DEFAULT = 2;

export const biasDeltaOverrides: Record<string, number> = {
  // the polygon seam model: canvas leaves the background on a shared edge
  'map-fit': 11, // 9.04
  'map-fit-stroked': 5.5, // 3.17, and 4.20 at dpr 2
  choropleth: 7, // 5.74
  'choropleth-stroked': 3.5, // 1.81, and 2.77 at dpr 2
  // Sparse, so almost every inked pixel is an edge and the average is the
  // coverage difference rather than a systematic error on top of it.
  regression: 8, // 6.67
  panzoom: 5, // 4.04
  'nulls-scatter-plot': 5, // 3.86
  'splom-outer': 4.5, // 3.46
  'splom-inner': 4, // 3.20
  'scatter-plot-guides': 4, // 3.26
  'layout-splom': 4, // 3.16
  'contour-scatter': 3, // 2.34
  'line-curves': 3, // 2.09 in CI, whose canvas draws the gapped line 6% heavier, with the webgpu pixels the same as here
  // text, which is all edge
  label: 4, // 2.90
  // the drift option moves labels onto the rows canvas puts them on, which
  // takes the count of wrong pixels down and leaves the glyph fringe alone
  'label-drift': 4, // 2.91
};

/** The flat sample and the ink a case needs, in test/measures.js with the rest of the gate. */
export const { FLAT_MIN_SAMPLE, INK_MIN_RATIO } = RenderMeasures;

/** Per-spec flat-region budgets, for anything that cannot hold the default. */
export const flatMeanDeltaOverrides: Record<string, number> = {};

/**
 * Per-spec mean channel error, for the specs measuring over half the default.
 * Roughly 2x the local measurement, noted after each, since CI rasterizes text
 * on a different font stack. Same reasons as crossCheckOverrides below.
 */
export const meanDeltaOverrides: Record<string, number> = {
  // Curve construction still differs from canvas.
  'line-curves': 26, // 13.09 at dpr 1, 7.15 at dpr 2

  // Geographic outlines: the seam between abutting fills is most of the ink.
  'map-fit': 21, // 10.42 at dpr 1, 5.89 at dpr 2
  'map-fit-stroked': 21, // 10.10 at dpr 1, 5.59 at dpr 2
  'choropleth-stroked': 16, // 8.02 at dpr 1, 3.18 at dpr 2
  choropleth: 13, // 6.31 at dpr 1, 3.24 at dpr 2

  // GPU text, many small labels each carrying its own glyph fringe.
  regression: 15, // 7.19 at dpr 1, 5.21 at dpr 2
};

/**
 * The CI runner has no GPU, so canvas, the reference, is rasterized on the CPU
 * there and on the GPU on a desktop. The two differ in antialiased coverage and
 * in how a dash wraps the start of a closed path, so a few cases carry budgets
 * for the runner below. CPU_CANVAS=1 rasterizes canvas the same way locally and
 * reads the runner's numbers. Only those runs use the tables, so the budget a
 * developer normally sees stays as tight as it was.
 */
export const cpuCanvas = !!process.env.CI || !!process.env.CPU_CANVAS;

/** The pixel ratio the suite is running at, which RENDER_DPR sets. */
export const renderDpr = Number(process.env.RENDER_DPR ?? 1);

/** Per-spec budgets for the CI rasterizer, with the measured number in a note. */
export const ciCrossCheckOverrides: Record<string, number> = {
  // 1.263% there, 0.675% on a real adapter: the seam between abutting fills
  'choropleth-stroked': 0.016,
  // 0.875% there, 0.365% on a real adapter
  'map-fit-stroked': 0.012,
  // 0.914% there
  'map-bind': 0.012,
};

/** Per-spec signed-mean budgets for the CI rasterizer. */
export const ciBiasDeltaOverrides: Record<string, number> = {
  // the polygon seam model again, where the two rasterizers differ most
  'map-fit-stroked': 11, // 8.66 there, 3.17 here
  'choropleth-stroked': 5.5, // 4.49 there, 1.81 here
  // dense small marks, so most inked pixels are antialiased edge
  'scatter-brush-panzoom': 3.5, // 2.72 there
  'dot-plot': 3.5, // 2.67 there
  'legends-ordinal': 3.5, // 2.58 there
  'quantile-dot-plot': 3, // 2.31 there
  'map-bind': 3, // 2.26 there
};

/** Per-spec densest-tile budgets for the CI rasterizer. */
export const ciTileOverrides: Record<string, number> = {
  // 40.0% in one 32px square there, 23.3% on a real adapter
  'map-fit-stroked': 0.45,
};

/**
 * Measured locally, then given roughly 2x headroom because CI renders on a
 * different font stack and shifts glyph antialiasing. `null` skips the
 * comparison.
 *
 * An entry that loosens the default stays only while its case has under 1.5x
 * headroom under it, since holding a spec to within a few percent of what it
 * reads is a flake rather than a gate. Everything else goes, whatever it once
 * needed: a budget left far above what its case measures cannot tell a
 * legitimate difference from a defect. An entry that tightens the default is a
 * separate thing and says so. Both readings are noted, because the worse of the
 * two ratios is what the one number has to cover.
 */
export const crossCheckOverrides: Record<string, number | null> = {
  // The four labels of `label` that sit on a half pixel, which is what the
  // drift option exists for. With it on they land on canvas's rows and what
  // is left is the glyph fringe, so the two readings are gated apart rather
  // than both sitting under the default.
  label: 0.002, // 0.110% at dpr 1, 0.000% at dpr 2
  'label-drift': 0.0002, // 0.003% at dpr 1, 0.000% at dpr 2

  // The three that are inside the default with under 1.5x of room, so a
  // rasterizer that antialiases differently would fail a case that is not
  // wrong. The twelve entries the text and curve work closed are gone.
  choropleth: 0.016, // 0.770% at dpr 1, 0.363% at dpr 2: the seam between abutting fills
  'dot-plot': 0.014, // 0.494% at dpr 1, 0.673% at dpr 2: many small labels, each with its own glyph fringe
  'map-point-radius': 0.013, // 0.635% at dpr 1, 0.372% at dpr 2: geographic outlines
};
