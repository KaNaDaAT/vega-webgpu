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
export const sceneCheckOverrides: Record<string, number | null> = {};
