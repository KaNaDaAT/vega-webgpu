import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { diffPngs, png, renderInHarness, saveArtifact, type RendererName, type RenderResult } from './compare.js';
import { SCENE_CHECK_DEFAULT, renderScenes, sceneCheckOverrides } from './scenes.js';

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
      saveArtifact(sceneName, 'webgpu', webgpu.png);
      expect(webgpu.rendererKind, `expected WebGPU to render, got '${webgpu.rendererKind}'`).toBe('webgpu');

      const canvas = await renderScene(page, sceneName, 'canvas');
      await testInfo.attach(`${sceneName}-canvas`, png(canvas.png));
      saveArtifact(sceneName, 'canvas', canvas.png);
      expect(canvas.rendererKind, `expected canvas to render, got '${canvas.rendererKind}'`).toBe('canvas');

      const budget = Object.hasOwn(sceneCheckOverrides, sceneName)
        ? sceneCheckOverrides[sceneName]
        : SCENE_CHECK_DEFAULT;
      if (budget === null) {
        return; // comparison intentionally skipped for this fixture
      }

      const { diffRatio, diff } = diffPngs(webgpu.png, canvas.png, sceneName);
      await testInfo.attach(`${sceneName}-diff (${(diffRatio * 100).toFixed(2)}%)`, png(diff));
      saveArtifact(sceneName, 'diff', diff);
      if (process.env.CROSS_REPORT) {
        console.log(`DIFF scene:${sceneName} ${(diffRatio * 100).toFixed(3)}%`);
      }
      expect(
        diffRatio,
        `webgpu vs canvas diff ${(diffRatio * 100).toFixed(3)}% exceeds ${(budget * 100).toFixed(1)}%. ` +
          `Open the HTML report (npm run test:report) to compare`,
      ).toBeLessThanOrEqual(budget);
    });
  }
});
