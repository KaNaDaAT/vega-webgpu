import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { compareCase, renderInHarness, type RendererName, type RenderResult } from './compare.js';
import {
  CROSS_CHECK_DEFAULT,
  FLAT_MEAN_DEFAULT,
  BIAS_DELTA_DEFAULT,
  MEAN_DELTA_DEFAULT,
  TILE_CHECK_DEFAULT,
  ciCrossCheckOverrides,
  ciTileOverrides,
  crossCheckOverrides,
  flatMeanDeltaOverrides,
  biasDeltaOverrides,
  meanDeltaOverrides,
  onCi,
  specCases,
  type SpecCase,
} from './specs.js';
import { specNames } from '../../scripts/specs-manifest.mjs';

/**
 * The demo page cannot read a directory, so it picks its spec list out of
 * test/specs-valid.json, which `npm run manifest` generates. A stale manifest
 * leaves a spec testable here but missing from the page.
 */
test('the demo page lists every spec on disk', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const listed: string[] = JSON.parse(readFileSync(join(root, 'specs-valid.json'), 'utf8'));
  expect([...listed].sort(), 'run: npm run manifest').toEqual(specNames());
});

function renderSpec(page: Page, kase: SpecCase, renderer: RendererName): Promise<RenderResult> {
  const url = `/test/render/harness.html?spec=${encodeURIComponent(kase.spec)}&renderer=${renderer}${kase.query}`;
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
  for (const kase of specCases) {
    const name = kase.name;
    test(name, async ({ page }, testInfo: TestInfo) => {
      const own = Object.hasOwn(crossCheckOverrides, name) ? crossCheckOverrides[name] : CROSS_CHECK_DEFAULT;
      await compareCase(testInfo, {
        name,
        kind: 'spec',
        file: name,
        source: kase.spec,
        render: (renderer: RendererName) => renderSpec(page, kase, renderer),
        budgets: {
          diff: onCi && own !== null ? (ciCrossCheckOverrides[name] ?? own) : own,
          tile: onCi ? (ciTileOverrides[name] ?? TILE_CHECK_DEFAULT) : TILE_CHECK_DEFAULT,
          mean: meanDeltaOverrides[name] ?? MEAN_DELTA_DEFAULT,
          bias: biasDeltaOverrides[name] ?? BIAS_DELTA_DEFAULT,
          flat: flatMeanDeltaOverrides[name] ?? FLAT_MEAN_DEFAULT,
        },
      });
    });
  }
});
