import { specNames } from '../../scripts/specs-manifest.mjs';

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
 * over everything. The worst observed is 23%, so this only catches a gross
 * localized failure the percentage would hide, and needs no per-spec list.
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
 * a mean of up to 12.9, and it catches a 5 level colour error where the mean
 * needs about 12.
 *
 * It does not apply everywhere, which is what the sample floor is for. Chart
 * ink is mostly edges: text and thin lines have no flat interior at all, and 29
 * of 132 pairs cannot fill the sample, so those keep the mean alone. This is
 * Skia Gold's Sobel matcher in miniature, which masks edges before diffing for
 * the same reason.
 */
export const FLAT_MEAN_DEFAULT = 3;

/**
 * Mean *signed* channel error allowed over the inked pixels of a spec. The
 * unsigned mean above cannot see a small systematic error on anything made of
 * edges, because legitimate antialiasing differences there are larger than it:
 * text and thin lines sit at a floor of about 12 levels. A systematic error
 * shifts every pixel the same way and a coverage difference does not, so the
 * signed mean separates them, and 102 of the 145 cases in the corpus sit under
 * 0.5 of a level on it.
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
  'bar-noaxis': 5, // 4.05
  panzoom: 5, // 4.04
  'nulls-scatter-plot': 5, // 3.86
  'splom-outer': 4.5, // 3.46
  'splom-inner': 4, // 3.20
  'scatter-plot-guides': 4, // 3.26
  'layout-splom': 4, // 3.16
  'contour-scatter': 3, // 2.34
  // text, which is all edge
  label: 4, // 2.90
  // the drift option moves labels onto the rows canvas puts them on, which
  // takes the count of wrong pixels down and leaves the glyph fringe alone
  'label-drift': 4, // 2.91
};

/**
 * Flat inked pixels a case needs before it is held to the budget above. A
 * smaller sample is a handful of pixels deciding a whole spec.
 */
export const FLAT_MIN_SAMPLE = 1000;

/** Per-spec flat-region budgets, for anything that cannot hold the default. */
export const flatMeanDeltaOverrides: Record<string, number> = {};

/**
 * Per-spec mean channel error, for the specs measuring over half the default.
 * Roughly 2x the local measurement, noted after each, since CI rasterizes text
 * on a different font stack. Same reasons as crossCheckOverrides below.
 */
export const meanDeltaOverrides: Record<string, number> = {
  // Curve construction still differs from canvas.
  'line-curves': 26, // 12.9

  // Geographic outlines: the seam between abutting fills is most of the ink.
  'map-fit-stroked': 25, // 12.3
  'map-fit': 21, // 10.1
  'choropleth-stroked': 18, // 8.6
  choropleth: 13, // 6.3

  // GPU text, many small labels each carrying its own glyph fringe.
  'layout-wrap': 15, // 7.4
  regression: 15, // 7.3
  barley: 13, // 6.4
};

/**
 * The CI runner rasterizes on SwiftShader, and its numbers are not the numbers
 * a real adapter gives. Windows SwiftShader passes the budgets below; the Linux
 * build on the runner does not, on cases whose difference is antialiasing
 * coverage rather than placement. Only the runner reads these, so the budget a
 * developer sees stays as tight as it was.
 */
export const onCi = !!process.env.CI;

/** The pixel ratio the suite is running at, which RENDER_DPR sets. */
export const renderDpr = Number(process.env.RENDER_DPR ?? 1);

/** True when a run is at a finer grid than the budgets were calibrated on. */
export const onFineGrid = renderDpr > 1;

/** Per-spec budgets for the CI rasterizer, with the measured number in a note. */
export const ciCrossCheckOverrides: Record<string, number> = {
  // 1.263% there, 0.675% on a real adapter: the seam between abutting fills
  'choropleth-stroked': 0.016,
  // 0.875% there, 0.365% on a real adapter
  'map-fit-stroked': 0.012,
};

/** Per-spec densest-tile budgets for the CI rasterizer. */
export const ciTileOverrides: Record<string, number> = {
  // 40.0% in one 32px square there, 23.3% on a real adapter
  'map-fit-stroked': 0.45,
};

/**
 * Measured locally, then given roughly 2x headroom because CI renders on a
 * different font stack and shifts glyph antialiasing. Tighten each toward the
 * default as the underlying gap closes. `null` skips the comparison.
 */
export const crossCheckOverrides: Record<string, number | null> = {
  // Curve construction still differs from canvas on these.
  'contour-scatter': 0.05, // ~2.5%
  'scatter-plot-contours': 0.015, // ~0.4%

  // GPU text: each label is rasterized to a texture whose glyph-edge
  // antialiasing differs subtly from canvas's direct drawing, and across many
  // small labels the fringe accumulates. Position, shape and rotation are all
  // correct. (roadmap: SDF/atlas text to close the residual fringe.)
  'legends-symbol': 0.03, // ~1.4%
  'nested-plot': 0.025, // ~1.2%
  'arc-diagram': 0.025, // ~1.1%, rotated radial labels
  'layout-wrap': 0.02, // ~0.8%
  'dot-plot': 0.02, // ~0.8%
  barley: 0.02, // ~0.7%
  regression: 0.015, // ~0.5%

  // Geographic outlines, see the roadmap.
  'map-point-radius': 0.03, // ~1.5%
  choropleth: 0.02, // ~0.8%
  'map-bind': 0.015, // ~0.7%
  'map-fit': 0.012, // ~0.5%

  // Radial link curves.
  'tree-radial': 0.012, // ~0.5%
  'tree-radial-bundle': 0.012, // ~0.5%
};
