import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  diffPngs,
  maxChannelDelta,
  png,
  renderInHarness,
  saveArtifact,
  type RendererName,
  type RenderResult,
} from './compare.js';
import {
  MAX_CHANNEL_DELTA_DEFAULT,
  SCENE_CHECK_DEFAULT,
  maxChannelDeltaOverrides,
  renderScenes,
  sceneCheckOverrides,
} from './scenes.js';
import { TILE_CHECK_DEFAULT } from './specs.js';

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
  for (const sceneName of renderScenes) {
    test(sceneName, async ({ page }, testInfo: TestInfo) => {
      const webgpu = await renderScene(page, sceneName, 'webgpu');
      await testInfo.attach(`${sceneName}-webgpu`, png(webgpu.png));
      saveArtifact(`scene-${sceneName}`, 'webgpu', webgpu.png);
      expect(webgpu.rendererKind, `expected WebGPU to render, got '${webgpu.rendererKind}'`).toBe('webgpu');

      const canvas = await renderScene(page, sceneName, 'canvas');
      await testInfo.attach(`${sceneName}-canvas`, png(canvas.png));
      saveArtifact(`scene-${sceneName}`, 'canvas', canvas.png);
      expect(canvas.rendererKind, `expected canvas to render, got '${canvas.rendererKind}'`).toBe('canvas');

      const budget = Object.hasOwn(sceneCheckOverrides, sceneName)
        ? sceneCheckOverrides[sceneName]
        : SCENE_CHECK_DEFAULT;
      if (budget === null) {
        return; // comparison intentionally skipped for this fixture
      }

      const deltaBudget = maxChannelDeltaOverrides[sceneName] ?? MAX_CHANNEL_DELTA_DEFAULT;
      const delta = maxChannelDelta(webgpu.png, canvas.png);
      expect(
        delta,
        `worst channel is ${delta} off canvas, over the ${deltaBudget} allowed. ` +
          `The pixel count below can miss this, since a coverage change stays under its colour threshold`,
      ).toBeLessThanOrEqual(deltaBudget);

      const { diffRatio, worstTile, worstTileAt, diff } = diffPngs(webgpu.png, canvas.png, sceneName);
      await testInfo.attach(`${sceneName}-diff (${(diffRatio * 100).toFixed(2)}%)`, png(diff));
      saveArtifact(`scene-${sceneName}`, 'diff', diff);
      if (process.env.CROSS_REPORT) {
        console.log(
          `DIFF scene:${sceneName} ${(diffRatio * 100).toFixed(3)}% TILE ${(worstTile * 100).toFixed(1)}% ` +
            `at ${worstTileAt.join(',')}`,
        );
      }
      expect(
        worstTile,
        `a 32px square at ${worstTileAt.join(',')} is ${(worstTile * 100).toFixed(1)}% different, ` +
          `over the ${(TILE_CHECK_DEFAULT * 100).toFixed(0)}% allowed. The whole-image number below ` +
          `is diluted by everything that matches`,
      ).toBeLessThanOrEqual(TILE_CHECK_DEFAULT);
      expect(
        diffRatio,
        `webgpu vs canvas diff ${(diffRatio * 100).toFixed(3)}% exceeds ${(budget * 100).toFixed(1)}%. ` +
          `Open the HTML report (npm run test:report) to compare`,
      ).toBeLessThanOrEqual(budget);
    });
  }
});
