import { expect, test, type Page } from '@playwright/test';
import { maxChannelDelta, renderInHarness, type RenderResult } from './compare.js';

/**
 * The two renderer options the harness can set. Nothing else in the suite
 * passes either, so the whole corpus runs at the default sample count and
 * through the shape cache, and both alternatives go untested.
 *
 * Each case also reads the option back off the renderer, since a knob that
 * never arrives leaves two identical renders and would pass on its own.
 */
interface Applied extends RenderResult {
  sampleCount: number;
  cacheShapes: boolean;
  shapeCacheEntries: number;
}

/** Renders through the harness, then reads what the options actually became. */
async function render(page: Page, url: string): Promise<Applied> {
  const result = await renderInHarness(page, url, 'webgpu');
  const state = await page.evaluate(() => {
    const r = (window as unknown as { view?: { _renderer?: Record<string, unknown> } }).view?._renderer;
    const options = r?.wgOptions as { sampleCount: number; cacheShapes: boolean };
    const ctx = r?._ctx as {
      _sampleCount: number;
      _markCache: Record<string, { cache?: Map<unknown, unknown> }>;
    };
    return {
      sampleCount: ctx._sampleCount,
      cacheShapes: options.cacheShapes,
      shapeCacheEntries: ctx._markCache.shape?.cache?.size ?? 0,
    };
  });
  return { ...result, ...state };
}

const specUrl = (spec: string, extra: string) => `/test/render/harness.html?spec=${spec}&renderer=webgpu${extra}`;

/** Pipelines bake the sample count, so a change has to reach them and redraw. */
test('a changed sample count reaches the pipelines', async ({ page }) => {
  test.setTimeout(120_000);
  // A triangulated fill with nothing stroked over it, which is what still takes
  // its coverage from MSAA. `arc` used to serve and no longer does: its outline
  // draws through the segment shader now, and that analytic stroke covers the
  // very edge the sample count would have shown, down to 6 channel levels at
  // dpr 1 and none at dpr 2.
  const msaa = await render(page, specUrl('stacked-area', ''));
  const single = await render(page, specUrl('stacked-area', '&sampleCount=1'));

  expect(msaa.sampleCount, 'the default is multisampled').toBeGreaterThan(1);
  expect(single.sampleCount, 'sampleCount=1 reached the context').toBe(1);
  // MSAA is where that edge gets its coverage, so one sample has to change the
  // picture rather than be quietly ignored
  expect(
    maxChannelDelta(msaa.png, single.png),
    'sampleCount=1 drew the same edges as the multisampled default',
  ).toBeGreaterThan(0);
});

/** The cache is geometry reuse, so it must be reachable and must not change the picture. */
test('the shape cache can be turned off and does not change the picture', async ({ page }) => {
  test.setTimeout(120_000);
  const cached = await render(page, specUrl('choropleth-stroked', '&cacheShapes=1'));
  const uncached = await render(page, specUrl('choropleth-stroked', '&cacheShapes=0'));

  expect(cached.cacheShapes, 'cacheShapes=1 leaves the cache on').toBe(true);
  expect(cached.shapeCacheEntries, 'and the shapes are cached').toBeGreaterThan(1000);
  expect(uncached.cacheShapes, 'cacheShapes=0 reached the renderer').toBe(false);
  expect(uncached.shapeCacheEntries, 'and nothing was cached').toBe(0);
  expect(
    maxChannelDelta(cached.png, uncached.png),
    'the shape cache changed the render, so it is not returning the geometry it stored',
  ).toBe(0);
});
