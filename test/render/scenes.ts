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
  // circle has its own shader, and cross, arrow and wedge are triangulated and
  // get their coverage from MSAA, which only expresses quarter steps.
  'symbol-shapes': 80,
  'symbol-custom': 80,
  // a triangulated ribbon, so its edge gets its coverage from MSAA
  trail: 90,
  // fixed function blending reproduces these exactly
  blend: 5,
  // these need the destination in the shader, so they draw unblended on purpose
  'blend-unsupported': 255,
  // Blending itself is right on every mark here. What is left is the edge: a
  // shape carrying analytic coverage in its alpha cannot also weight its colour
  // by that alpha with one set of blend factors, so an antialiased edge under
  // multiply is off. The line's is its join.
  'blend-marks': 145,
};
