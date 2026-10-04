import { expect, test } from '@playwright/test';
import { diffPngs, renderInHarness } from './compare.js';
import { harnessUrl } from './drive.js';

/**
 * `canvasTextDrift` places a label where the canvas renderer puts it rather
 * than where its own coordinates say, which are not the same thing when a
 * baseline lands on exactly half a device pixel. See util/canvasDrift.ts.
 *
 * `label` has four labels on that boundary and is the spec the option exists
 * for. `bar` has labels on the boundary too and no drift to move them, so it
 * holds the other half: the option has to leave those exactly alone.
 */
const url = (spec: string, renderer: string, extra = '') => harnessUrl('spec', spec, renderer, `&offscreen=1${extra}`);

/**
 * There is no tie to break at an even pixel ratio: a baseline half way between
 * two device pixels at ratio 1 is on a whole one at ratio 2, and `label`
 * already matches canvas on 0.000% of pixels there.
 */
const ratio = Number(process.env.RENDER_DPR ?? 1);

test('the canvas text drift option moves a half pixel label onto canvas', async ({ page }) => {
  test.setTimeout(180_000);
  test.skip(ratio !== 1, 'no half pixel baselines at this ratio');
  const canvas = await renderInHarness(page, url('label', 'canvas'), 'canvas');
  const off = diffPngs((await renderInHarness(page, url('label', 'webgpu'), 'webgpu')).png, canvas.png, 'label');
  const on = diffPngs(
    (await renderInHarness(page, url('label', 'webgpu', '&canvasTextDrift=1'), 'webgpu')).png,
    canvas.png,
    'label',
  );
  console.log(
    `label differing pixels ${(off.diffRatio * 100).toFixed(3)}% off, ${(on.diffRatio * 100).toFixed(3)}% on`,
  );
  expect(off.diffRatio, 'label should differ without the option, or it has nothing to fix').toBeGreaterThan(0.0008);
  expect(on.diffRatio, 'the option should close most of that').toBeLessThan(off.diffRatio / 3);
});

test('the canvas text drift option leaves a scene with no drift alone', async ({ page }) => {
  test.setTimeout(180_000);
  const canvas = await renderInHarness(page, url('bar', 'canvas'), 'canvas');
  const off = diffPngs((await renderInHarness(page, url('bar', 'webgpu'), 'webgpu')).png, canvas.png, 'bar');
  const on = diffPngs(
    (await renderInHarness(page, url('bar', 'webgpu', '&canvasTextDrift=1'), 'webgpu')).png,
    canvas.png,
    'bar',
  );
  expect(on.quadDelta, 'nothing to reproduce here, so nothing should move').toBeLessThanOrEqual(off.quadDelta);
  expect(on.diffRatio).toBeLessThanOrEqual(off.diffRatio + 1e-6);
});
