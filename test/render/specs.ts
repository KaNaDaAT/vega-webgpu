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
  'splom-outer-50k': '50k-point stress demo, too slow for software-rendered CI',
  'movies-sort': 'canvas exceeds the WebGPU max texture size; the renderer intentionally skips it',
};

/**
 * Every spec in test/specs-valid (minus the documented exclusions) is rendered
 * with both the WebGPU and canvas renderers and compared directly. There are
 * no stored image baselines, and the canvas renderer is the ground truth.
 */
export const renderSpecs: string[] = readdirSync(specsDir)
  .filter(f => f.endsWith('.vg.json'))
  .map(f => f.replace(/\.vg\.json$/, ''))
  .filter(s => !(s in excludedSpecs))
  .sort();

/**
 * Fraction of differing pixels allowed by default. 99 of the 111 specs measure
 * under 0.3%, so this is tight enough that a real regression fails rather than
 * hiding inside the budget. Every spec that needs more is listed below with the
 * reason, which keeps the exceptions visible instead of blanket-loose.
 */
export const CROSS_CHECK_DEFAULT = 0.005;

/**
 * Measured locally, then given roughly 2x headroom because CI renders on a
 * different font stack and shifts glyph antialiasing. Tighten each toward the
 * default as the underlying gap closes. `null` skips the comparison.
 */
export const crossCheckOverrides: Record<string, number | null> = {
  // Curve construction still differs from canvas on these.
  'contour-scatter': 0.025, // ~1.4%
  'scatter-plot-contours': 0.01, // ~0.3%

  // GPU text: each label is rasterized to a texture whose glyph-edge
  // antialiasing differs subtly from canvas's direct drawing, and across many
  // small labels the fringe accumulates. Position, shape and rotation are all
  // correct. (roadmap: SDF/atlas text to close the residual fringe.)
  'legends-symbol': 0.025, // ~1.2%
  'arc-diagram': 0.02, // ~0.8%, rotated radial labels
  'layout-wrap': 0.02, // ~0.8%
  'nested-plot': 0.02, // ~0.7%
  barley: 0.02, // ~0.6%
  regression: 0.01, // ~0.4%

  // Geographic outlines, see the roadmap.
  'map-point-radius': 0.015, // ~0.6%, plus the stray line still under investigation
  'map-fit': 0.01, // ~0.3%

  // Radial link curves.
  'tree-radial': 0.01, // ~0.3%
  'tree-radial-bundle': 0.01, // ~0.3%
};
