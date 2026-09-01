import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { diffPngs, png, renderInHarness, saveArtifact, type RendererName, type RenderResult } from './compare.js';
import { CROSS_CHECK_DEFAULT, crossCheckOverrides, renderSpecs } from './specs.js';

function renderSpec(page: Page, specName: string, renderer: RendererName): Promise<RenderResult> {
  const url = `/test/render/harness.html?spec=${encodeURIComponent(specName)}&renderer=${renderer}`;
  return renderInHarness(page, url, renderer);
}

/**
 * The renderer is validated purely by rendering each spec with both the
 * WebGPU and canvas renderers and comparing them directly, with no stored image
 * baselines. The canvas renderer is the ground truth the WebGPU output must
 * match. The budget is low by default, with documented per-spec exceptions
 * for known, not-yet-implemented differences.
 *
 * Every render and diff is attached to the test, so the Playwright HTML
 * report (`npm run test:report`, or the CI "render-report" artifact) is a
 * browsable webgpu-vs-canvas comparison gallery, passing tests included.
 */
test.describe('WebGPU vs canvas', () => {
  for (const specName of renderSpecs) {
    test(specName, async ({ page }, testInfo: TestInfo) => {
      const webgpu = await renderSpec(page, specName, 'webgpu');
      await testInfo.attach(`${specName}-webgpu`, png(webgpu.png));
      saveArtifact(specName, 'webgpu', webgpu.png);
      // Guard against a silent fallback: each renderer must actually be the
      // one that ran, otherwise the comparison is meaningless.
      expect(webgpu.rendererKind, `expected WebGPU to render, got '${webgpu.rendererKind}'`).toBe('webgpu');

      const canvas = await renderSpec(page, specName, 'canvas');
      await testInfo.attach(`${specName}-canvas`, png(canvas.png));
      saveArtifact(specName, 'canvas', canvas.png);
      expect(canvas.rendererKind, `expected canvas to render, got '${canvas.rendererKind}'`).toBe('canvas');

      const budget = Object.hasOwn(crossCheckOverrides, specName) ? crossCheckOverrides[specName] : CROSS_CHECK_DEFAULT;
      if (budget === null) {
        return; // comparison intentionally skipped for this spec
      }

      const { diffRatio, diff } = diffPngs(webgpu.png, canvas.png, specName);
      await testInfo.attach(`${specName}-diff (${(diffRatio * 100).toFixed(2)}%)`, png(diff));
      saveArtifact(specName, 'diff', diff);
      if (process.env.CROSS_REPORT) {
        console.log(`DIFF ${specName} ${(diffRatio * 100).toFixed(3)}%`);
      }
      expect(
        diffRatio,
        `webgpu vs canvas diff ${(diffRatio * 100).toFixed(3)}% exceeds ${(budget * 100).toFixed(1)}%. ` +
          `Open the HTML report (npm run test:report) to compare`,
      ).toBeLessThanOrEqual(budget);
    });
  }
});
