import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { compareCase, renderInHarness, type RendererName, type RenderResult } from './compare.js';
import {
  MAX_CHANNEL_DELTA_DEFAULT,
  SCENE_CHECK_DEFAULT,
  SCENE_FLAT_MEAN_DEFAULT,
  SCENE_BIAS_DELTA_DEFAULT,
  SCENE_MEAN_DELTA_DEFAULT,
  ciMaxChannelDeltaOverrides,
  dprMaxChannelDeltaOverrides,
  dprSceneCheckOverrides,
  maxChannelDeltaOverrides,
  renderScenes,
  sceneCheckOverrides,
  sceneFlatMeanOverrides,
  sceneBiasDeltaOverrides,
  sceneMeanDeltaOverrides,
} from './scenes.js';
import { TILE_CHECK_DEFAULT, onCi, onFineGrid } from './specs.js';

/**
 * The fixture list is a directory read with nothing behind it, so an empty or
 * moved test/render/scenes generates no tests at all and the suite goes green
 * having compared nothing.
 */
test('there are fixtures to compare', () => {
  expect(renderScenes.length, 'test/render/scenes has no fixtures in it').toBeGreaterThan(10);
});

/** A fixture's own description, which says which mode or shape each part is. */
function sceneNote(name: string): string {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), 'scenes', `${name}.json`);
    return (JSON.parse(readFileSync(file, 'utf8')).description as string) ?? '';
  } catch {
    return '';
  }
}

function renderScene(page: Page, sceneName: string, renderer: RendererName): Promise<RenderResult> {
  const url = `/test/render/scene-harness.html?scene=${encodeURIComponent(sceneName)}&renderer=${renderer}`;
  return renderInHarness(page, url, renderer);
}

/**
 * Mark-level checks: each fixture is a stored scenegraph handed straight to the
 * renderer, with no View, no dataflow and no layout in between. The canvas
 * renderer is the ground truth, same as the spec suite.
 */
test.describe('scenes', () => {
  for (const name of renderScenes) {
    test(name, async ({ page }, testInfo: TestInfo) => {
      const diff =
        onFineGrid && Object.hasOwn(dprSceneCheckOverrides, name)
          ? dprSceneCheckOverrides[name]
          : Object.hasOwn(sceneCheckOverrides, name)
            ? sceneCheckOverrides[name]
            : SCENE_CHECK_DEFAULT;
      // A fixture is small synthetic geometry, so the worst pixel means
      // something here in a way it does not on a full spec.
      const ownDelta = onFineGrid
        ? (dprMaxChannelDeltaOverrides[name] ?? maxChannelDeltaOverrides[name] ?? MAX_CHANNEL_DELTA_DEFAULT)
        : (maxChannelDeltaOverrides[name] ?? MAX_CHANNEL_DELTA_DEFAULT);
      await compareCase(testInfo, {
        name,
        kind: 'fixture',
        file: `scene-${name}`,
        label: `scene:${name}`,
        note: sceneNote(name),
        render: (renderer: RendererName) => renderScene(page, name, renderer),
        budgets: {
          diff,
          tile: TILE_CHECK_DEFAULT,
          mean: sceneMeanDeltaOverrides[name] ?? SCENE_MEAN_DELTA_DEFAULT,
          bias: sceneBiasDeltaOverrides[name] ?? SCENE_BIAS_DELTA_DEFAULT,
          flat: sceneFlatMeanOverrides[name] ?? SCENE_FLAT_MEAN_DEFAULT,
          max: onCi ? (ciMaxChannelDeltaOverrides[name] ?? ownDelta) : ownDelta,
        },
      });
    });
  }
});
