import { expect, test } from '@playwright/test';
import { waitForRender } from './drive.js';

/**
 * vega swaps renderers by dropping the old one without finalizing it, so
 * taking over an element has to release whoever held it before.
 */
test('swapping renderers does not pile up devices', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/test/render/harness.html?spec=bar&renderer=webgpu');
  await waitForRender(page, 90_000);
  const out = await page.evaluate(async () => {
    let made = 0;
    let lost = 0;
    const origReq = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...a: unknown[]) {
      made++;
      const d = (await origReq.apply(this, a as never)) as GPUDevice;
      d.lost.then(() => lost++);
      return d;
    };
    const view = (window as unknown as { view: { renderer: (t: string) => unknown; runAsync: () => Promise<unknown> } })
      .view;
    // vega builds a fresh renderer on every swap back, and it starts from the
    // defaults rather than the options the harness applied to the first one
    const offscreen = () => {
      const options = (view as unknown as { _renderer?: { wgOptions?: { offscreen: boolean } } })._renderer?.wgOptions;
      if (options) {
        options.offscreen = true;
      }
    };
    for (let i = 0; i < 4; i++) {
      view.renderer('canvas');
      await view.runAsync();
      view.renderer('webgpu');
      offscreen();
      await view.runAsync();
    }
    await new Promise(r => setTimeout(r, 400));
    return { made, lost, live: made - lost };
  });
  console.log(JSON.stringify(out));
  expect(out.made, 'each swap back builds a renderer').toBeGreaterThanOrEqual(4);
  expect(out.live, 'but only the current one still holds a device').toBeLessThanOrEqual(1);
});
