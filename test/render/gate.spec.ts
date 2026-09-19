import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { diffPngs, renderInHarness } from './compare.js';
import { BIAS_DELTA_DEFAULT, MEAN_DELTA_DEFAULT } from './specs.js';

/** The same render with every drawn pixel a few channel levels darker. */
function darken(buf: Buffer, levels: number): Buffer {
  const img = PNG.sync.read(buf);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) {
      continue;
    }
    for (let c = 0; c < 3; c++) {
      img.data[i + c] = Math.max(0, img.data[i + c] - levels);
    }
  }
  return PNG.sync.write(img);
}

/**
 * What each gate can see, on a render against itself with a known error added,
 * so the numbers are the error rather than an argument about one.
 *
 * `stocks-index` is text and a thin line, which is the case the other measures
 * are weakest on: it has almost no interior, so the flat-region check cannot
 * fill its sample, and the differing-pixel count ignores anything under 39
 * levels. Four levels is well inside both of those and outside the signed mean.
 */
test('the signed mean sees a systematic error the pixel count cannot', async ({ page }) => {
  test.setTimeout(180_000);
  const shot = await renderInHarness(
    page,
    '/test/render/harness.html?spec=stocks-index&renderer=webgpu&offscreen=1',
    'webgpu',
  );
  const off = diffPngs(darken(shot.png, 4), shot.png, 'stocks-index');
  console.log(
    `GATE 4 levels darker: ${(off.diffRatio * 100).toFixed(3)}% of pixels differ, ` +
      `mean ${off.meanDelta.toFixed(2)}, bias ${off.biasDelta.toFixed(2)}, worst channel ${off.quadDelta}`,
  );

  expect(off.diffRatio, 'the pixel count should be blind to this').toBeLessThan(0.0001);
  expect(off.meanDelta, 'the unsigned mean should be under its budget too').toBeLessThanOrEqual(MEAN_DELTA_DEFAULT);
  expect(off.biasDelta, 'the signed mean is the one that has to see it').toBeGreaterThan(BIAS_DELTA_DEFAULT);
});

/** And the same render against itself has to read as no error at all. */
test('an identical render carries no bias', async ({ page }) => {
  test.setTimeout(180_000);
  const shot = await renderInHarness(
    page,
    '/test/render/harness.html?spec=stocks-index&renderer=webgpu&offscreen=1',
    'webgpu',
  );
  const same = diffPngs(shot.png, shot.png, 'stocks-index');
  expect(same.biasDelta).toBe(0);
  expect(same.meanDelta).toBe(0);
});
