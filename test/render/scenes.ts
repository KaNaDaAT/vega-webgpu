import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scenesDir = join(dirname(fileURLToPath(import.meta.url)), 'scenes');

/**
 * Scenegraph fixtures, rendered by driving the renderer directly rather than
 * through a View. Vega tests its own renderers the same way (serialized
 * scenegraphs in vega-scenegraph/test/resources), and it keeps a failure
 * pinned to the mark code instead of anything in parse, scales or layout.
 *
 * Every file in test/render/scenes is picked up automatically.
 */
export const renderScenes: string[] = readdirSync(scenesDir)
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace(/\.json$/, ''))
  .sort();

/**
 * Fixtures are geometry with no data pipeline in front of them, so they hold a
 * tighter budget than the full specs. Anything needing more is listed below
 * with the reason.
 */
export const SCENE_CHECK_DEFAULT = 0.002;

/** Per-fixture budgets. `null` skips the comparison. */
export const sceneCheckOverrides: Record<string, number | null> = {
  // Six dashed and capped borders on a corner radius, which is where the dash
  // phase around a curve differs. group-corner-dash carries the same cause.
  'group-variants': 0.004, // 0.230%
};

/**
 * Mean channel error allowed over the inked pixels of a fixture. The worst pixel
 * above misses a small error spread over everything just as the pixel count
 * does: a fixture drawn 39 levels too dark reads 0% different and a worst
 * channel of 39, inside both budgets. See the longer note in specs.ts.
 */
export const SCENE_MEAN_DELTA_DEFAULT = 10;

/** The same signed-mean budget for fixtures. See the note in specs.ts. */
export const SCENE_BIAS_DELTA_DEFAULT = 2;

export const sceneBiasDeltaOverrides: Record<string, number> = {};

/**
 * Flat-region budget for fixtures. See the note in specs.ts: a fixture that is
 * all edges, which most of the line and rule ones are, cannot fill the sample
 * and keeps the mean alone.
 */
export const SCENE_FLAT_MEAN_DEFAULT = 3;

/** Per-fixture flat-region budgets, for anything that cannot hold the default. */
export const sceneFlatMeanOverrides: Record<string, number> = {};

/** Per-fixture mean channel error, roughly 2x the local measurement. */
export const sceneMeanDeltaOverrides: Record<string, number> = {
  // both renderers approximate a slanted edge, see the note below
  'rule-diagonals': 26, // 12.6
};

/**
 * Largest channel difference allowed between block averages, over blocks two
 * scene pixels a side. See BLOCK_SCENE_PX in compare.ts.
 *
 * One number for both pixel ratios, because the block is measured in scene
 * units: at dpi 2 it covers four times the device pixels and reads the same.
 * The single-pixel worst it replaces needed 28 per-fixture budgets, 17 more
 * for the finer grid and 4 more for CI, because one antialiased edge pixel
 * landing the other side of a rounding boundary reads 255 on a render that is
 * otherwise exact.
 */
export const QUAD_DELTA_DEFAULT = 70;

/** Per-fixture, where the default does not fit. Measured, with the reason. */
export const quadDeltaOverrides: Record<string, number> = {};

/**
 * Fixtures that are not gated, and why. A budget raised past what a measure
 * says is a defect written down as if it were a tolerance, so a case we know
 * is wrong is skipped here rather than passing on a number chosen to let it
 * through.
 *
 * A skip carries the release it is queued for, so it reaches the gallery, the
 * test report and the roadmap as work with a date on it rather than as a
 * silent gap. `upstream` is the one that is not ours: canvas is the side that
 * is wrong and matching it would mean copying the defect.
 */
export interface SkippedScene {
  /** The release this is queued for, as ToDo.md groups it. */
  milestone: '2.0.0' | '2.1.0' | 'upstream';
  /** One line, which is what a list of skips shows. */
  summary: string;
  /** The whole account, which README.md carries the long form of. */
  reason: string;
}

export const skippedScenes: Record<string, SkippedScene> = {
  'gradient-diagonal': {
    milestone: 'upstream',
    summary: 'canvas draws a diagonal ramp as a pattern at the group origin and leaves marks blank',
    reason:
      "a ramp that is neither horizontal nor vertical, on bounds that are not square, is vega's " +
      'pattern path rather than a canvas gradient, and a pattern is placed at the group origin: a ' +
      'mark away from it is drawn with part of the ramp or with none of it at all. This renderer ' +
      'spans the ramp over the bounds wherever the mark is, which reads 23.057% of pixels, a 100% ' +
      'worst tile and a signed mean of 76.52 against canvas. We are the correct side of this one, ' +
      'so matching it would mean deliberately not drawing marks. It wants an upstream report ' +
      'rather than a fix here. See README.md.',
  },
  'clip-path-round': {
    milestone: '2.0.0',
    summary: 'a clip that is a path is cut to the box of that path, so the corners are still drawn',
    reason:
      'a clip that is a path is taken as the box of that path, since a scissor rect is the only ' +
      'clip a mark can be held to, so the corners canvas cuts away are still drawn: 14.004% of ' +
      'pixels, worst block 179. clip-path-box holds the rectangular case, which is exact. ' +
      'Clipping to the path itself wants a coverage mask sampled by every mark shader or a ' +
      'stencil attachment on every pipeline, which is the same machinery two nested rounded ' +
      'clips want. It is a vega form drawn differently with nothing said, which is what 2.0.0 ' +
      'is defined as closing, and it is also the most expensive thing on that list. Nothing in ' +
      'the spec corpus uses the form, so it is the first candidate if that scope is cut. ' +
      'See README.md.',
  },
};
