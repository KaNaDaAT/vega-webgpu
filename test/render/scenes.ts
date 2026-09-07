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
  // drawn unblended on purpose, so the pixel count is not meaningful
  'blend-unsupported': null,
  // Dense outlines on triangulated marks, whose edge coverage comes from MSAA.
  // Almost every differing pixel is one of those edges.
  'arc-shapes': 0.004,
  'path-shapes': 0.012,
  // thick strokes on rings and curves, so the ribbon edge is most of the ink
  'gradient-strokes': 0.005,
};

/**
 * Largest single channel difference allowed per fixture. The pixel count only
 * says how much moved, and pixelmatch's colour threshold tolerates a 30 unit
 * error, so a coverage change can be invisible to it. This catches that: a
 * fixture we match exactly must keep matching exactly.
 */
export const MAX_CHANNEL_DELTA_DEFAULT = 70;

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
  // Triangulated marks take their edge coverage from MSAA, which expresses
  // quarter steps: an edge landing on a pixel boundary reads 1 or 3 samples
  // where canvas fills the pixel. rect, rule, symbol and segments are analytic,
  // these are not.
  'arc-shapes': 130,
  'area-shapes': 80,
  'path-shapes': 180,
  // Rings and curves drawn thick, so the ribbon edge is the whole difference,
  // the same gap arc-shapes carries.
  'gradient-strokes': 120,
  // Both renderers approximate a slanted edge. Against exact pixel coverage
  // these are 3.1 levels off on average where canvas is 15.8, so the budget is
  // mostly canvas's own error.
  'rule-diagonals': 70,
  // Held by canvas, not by us. Against exact pixel coverage these circles are
  // 0.6 levels off on average for a fill and 2.3 for a stroke, worst 12, where
  // canvas is 1.5 and 10.4 and worst 90 on an arc running nearly tangent to a
  // pixel row. The budget tracks how far canvas is from the truth.
  'symbol-circles': 80,
  // fixed function blending reproduces these exactly
  blend: 5,
  // these need the destination in the shader, so they draw unblended on purpose
  'blend-unsupported': 255,
  // Not the blend. The arc and path get their edge coverage from MSAA quarter
  // steps and the line's join is shorter than canvas's, both by the same amount
  // with no blend set.
  'blend-marks': 145,
};
