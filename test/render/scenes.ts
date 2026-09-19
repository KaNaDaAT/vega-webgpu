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
  // Dense outlines on triangulated marks, whose edge coverage comes from MSAA.
  // Almost every differing pixel is one of those edges.
  'arc-shapes': 0.004,
  'path-shapes': 0.012,
  // thick strokes on rings and curves, so the ribbon edge is most of the ink
  'gradient-strokes': 0.005,
  // A dashed path matches exactly on a straight run. Around a corner and on a
  // closed ring the phase differs, because the contour this walks does not
  // start where canvas starts the path, so every dash after it is shifted.
};

/**
 * Largest single channel difference allowed per fixture. The pixel count only
 * says how much moved, and pixelmatch's colour threshold tolerates a 30 unit
 * error, so a coverage change can be invisible to it. This catches that: a
 * fixture we match exactly must keep matching exactly.
 */
export const MAX_CHANNEL_DELTA_DEFAULT = 70;

/**
 * Mean channel error allowed over the inked pixels of a fixture. The worst pixel
 * above misses a small error spread over everything just as the pixel count
 * does: a fixture drawn 39 levels too dark reads 0% different and a worst
 * channel of 39, inside both budgets. See the longer note in specs.ts.
 */
export const SCENE_MEAN_DELTA_DEFAULT = 10;

/**
 * The same signed-mean budget for fixtures. See the note in specs.ts. Only one
 * fixture is over it, and on purpose.
 */
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
 * Worst-channel budgets for the CI rasterizer. See the note in specs.ts: these
 * are read only on the runner, so a local run keeps the tight numbers.
 */
export const ciMaxChannelDeltaOverrides: Record<string, number> = {
  'gradient-strokes': 140, // 132 there
  'rect-subpixel': 32, // 29 there, 1 on a real adapter
  'rule-subpixel': 4, // 3 there, 1 on a real adapter
  'symbol-analytic': 52, // 47 there
};

/**
 * Worst-channel budgets at a pixel ratio above 1, where the numbers below do
 * not hold. The same geometric error lands on a finer grid, so one edge pixel
 * can be further off in a single channel while less of the frame moves at all.
 *
 * Raising a budget is the wrong answer when a render is wrong, so these are
 * only here because the flat-region measure says it is not: at dpr 2 every one
 * of these reports a flat mean of 0.00 or 0.50 over 1.7k to 154k pixels, which
 * is the mark interiors matching exactly, and the differing-pixel counts run
 * from 0.006% to 0.45%. The whole difference is edge coverage, which is the
 * analytic coverage item rather than a defect of its own.
 */
export const dprMaxChannelDeltaOverrides: Record<string, number> = {
  'gradient-strokes': 215, // 191 at dpr 2
  'arc-sweeps': 90, // 73
  'mark-dashes': 170, // 151
  'group-corner-dash': 150, // 131
  'symbol-shapes': 140, // 117
  'blend-marks': 125, // 106
  'symbol-custom': 105, // 88
  'line-shapes': 85, // 71
};

/** Differing-pixel budgets at a pixel ratio above 1, for the same reason. */
export const dprSceneCheckOverrides: Record<string, number> = {};

export const maxChannelDeltaOverrides: Record<string, number> = {
  // Analytic coverage, so these track canvas to within rounding.
  'rect-subpixel': 2,
  'rule-subpixel': 2,
  'text-layout': 2,
  // Shapes with a distance function are drawn analytically, so they track
  // canvas the way rects and rules do.
  'symbol-analytic': 25,
  // circle has its own shader and cross is triangulated, so its coverage comes
  // from MSAA, which only expresses quarter steps.
  'symbol-shapes': 80,
  'symbol-custom': 80,
  // a triangulated ribbon, so its edge gets its coverage from MSAA
  trail: 90,
  // Where two of a trail's contour strokes cross at an acute angle, the mask
  // keeps the larger of the two coverages on that pixel, and the union canvas
  // fills is larger still. One pixel at the tip of each crossing.
  'trail-stroked': 100, // 81, and 80 at dpr 2
  'trail-overlap': 170, // 83, and 147 at dpr 2
  // Dash ends meeting across a gap under the stroke width, blended and not. The
  // cut where two facing caps meet is hard on both sides, so the worst pixel is
  // where a round arc crosses that plane.
  'dash-caps': 190, // 105, and 170 at dpr 2
  // One big corner, dashed, with the phase moved so the corner falls inside a
  // run in one row and inside a gap in the next. What is left is the angle of
  // one dash edge near the corner, a pixel or two wide.
  'dash-corner': 190, // 121, and 170 at dpr 2
  // Triangulated marks take their edge coverage from MSAA, which expresses
  // quarter steps: an edge landing on a pixel boundary reads 1 or 3 samples
  // where canvas fills the pixel. rect, rule, symbol and segments are analytic,
  // these are not.
  'arc-shapes': 130,
  'arc-sweeps': 90, // 67
  'area-shapes': 80,
  'path-shapes': 180,
  // Several of these are a sliver on purpose, since a degenerate shape is what
  // catches a command read wrongly, and a sliver is all edge.
  'path-commands': 160, // 135, and the same at dpr 2
  // Rings and curves drawn thick, dashed as well, and a symbol, rect, rule and
  // line whose ramps take the outline walk. Every run has two more ends on a
  // curve the two renderers flatten differently, and a square symbol's corner
  // carries the sharp corner artifact that has its own open item: the same symbols with a
  // solid dashed stroke read 231 there, so it is the outline and not the ramp.
  'gradient-strokes': 175, // 155
  // Both renderers approximate a slanted edge. Against exact pixel coverage
  // these are 3.1 levels off on average where canvas is 15.8, so the budget is
  // mostly canvas's own error.
  'rule-diagonals': 70,
  // Held by canvas, not by us. Against exact pixel coverage these circles are
  // 0.6 levels off on average for a fill and 2.3 for a stroke, worst 12, where
  // canvas is 1.5 and 10.4 and worst 90 on an arc running nearly tangent to a
  // pixel row. The budget tracks how far canvas is from the truth.
  'symbol-circles': 80,
  // multiply and screen are the blend state, darken and lighten are evaluated
  // against a copy of the frame, and both come back exact
  blend: 5,
  // Not the blend. The arc and path get their edge coverage from MSAA quarter
  // steps, with no blend set and by the same amount.
  'blend-marks': 90, // 53
  // area and trail carry the ribbon edge their own fixtures do, and a dash adds
  // two ends to every run of it.
  'mark-dashes': 130, // 115
  // The outline is flattened before the dash is walked along it, so it is half
  // a pixel shorter than the curve around the whole border. Cutting the corners
  // finer to close that moved the dashes further from canvas rather than
  // nearer, which says canvas is not measuring the curve either.
  'group-corner-dash': 100, // 87
};
