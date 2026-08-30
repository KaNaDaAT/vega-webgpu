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
 * The default budget (fraction of differing pixels) is low and only absorbs
 * antialiasing/edge differences between the two rasterizers. Overrides list
 * specs with a known, documented divergence. `null` skips the comparison.
 * Tighten each toward the default as the underlying gap is closed.
 */
export const CROSS_CHECK_DEFAULT = 0.03;

// Budgets are calibrated from measured webgpu-vs-canvas diffs with headroom.
// They may need widening on CI, where a different OS/font stack shifts text
// antialiasing. Only specs that exceed the default get an entry.
export const crossCheckOverrides: Record<string, number | null> = {
  // (symbol shapes + rotation now match canvas, `symbol-shapes` and
  // `symbol-angle` hold at the default budget.)

  // (gradient fills, including on symbols, now match canvas at the default
  // budget, the radial concentric approximation is close enough here.)

  // --- Curved links in tree-radial-bundle are constructed differently from
  // canvas (other curved-link specs match). (roadmap: investigate, see TODO.md)
  'tree-radial-bundle': 0.13, // ~12.1%

  // --- GPU text: each label is rasterized to a texture whose glyph-edge
  // antialiasing differs subtly from canvas's direct drawing. Across many
  // small labels this fringe accumulates. Position, shape and rotation are all
  // correct. Rotation is now baked into the glyph texture, so rotated labels
  // (arc-diagram, ~0.8%) are pixel-snapped and crisp too, and pass at the
  // default budget. (roadmap: SDF/atlas text to close the residual fringe.)
  'nested-plot': 0.06, // ~5.0%
  barley: 0.04, // ~3.2%
  'layout-facet': 0.04, // ~3.0% (near the default; explicit to avoid flakiness)
};
