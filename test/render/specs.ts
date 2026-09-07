import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const specsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'specs-valid');

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
 */
export const renderSpecs: string[] = readdirSync(specsDir)
  .filter(f => f.endsWith('.vg.json'))
  .map(f => f.replace(/\.vg\.json$/, ''))
  .filter(s => !(s in excludedSpecs))
  .sort();

/**
 * Fraction of differing pixels allowed by default. Antialiased pixels are
 * counted (see compare.ts), so these budgets cover the whole difference rather
 * than the part pixelmatch does not classify as antialiasing. Most specs
 * measure under 0.4%, so this is tight enough that a real regression fails
 * rather than hiding inside the budget. Every spec that needs more is listed
 * below with the reason, which keeps the exceptions visible instead of
 * blanket-loose.
 */
/**
 * Densest 32px square of difference a spec may have, as a fraction of that
 * square. The whole-image percentage is diluted by however much of a spec is
 * empty or flat, so a small region that is badly wrong reads like a faint haze
 * over everything. The worst observed is 23%, so this only catches a gross
 * localized failure the percentage would hide, and needs no per-spec list.
 */
export const TILE_CHECK_DEFAULT = 0.35;

export const CROSS_CHECK_DEFAULT = 0.008;

/**
 * The CI runner rasterizes on SwiftShader, and its numbers are not the numbers
 * a real adapter gives. Windows SwiftShader passes the budgets below; the Linux
 * build on the runner does not, on cases whose difference is antialiasing
 * coverage rather than placement. Only the runner reads these, so the budget a
 * developer sees stays as tight as it was.
 */
export const onCi = process.env.CI !== undefined;

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
