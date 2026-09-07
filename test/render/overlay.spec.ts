import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * The wipe stacks the two renderers, so the top one has to cover the bottom
 * one. A canvas is transparent wherever nothing was drawn, so a mark only one
 * of them has would otherwise show through on both sides of the divider.
 */
test('the top layer covers the one under it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/test/?spec=bar&renderer=webgpu&version=dev&compare=1');
  await page.waitForFunction(
    () => (window as unknown as { __compared?: unknown[] }).__compared?.length === 2,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(500);

  const painted = await page.evaluate(() => {
    // the whole width goes to the top layer, so nothing of the bottom is meant
    // to be visible
    const wipe = document.querySelector('#wipe') as HTMLInputElement;
    wipe.value = '0';
    wipe.dispatchEvent(new Event('input'));
    // a marker on the bottom canvas, standing in for a mark only it drew
    const canvas = document.querySelector('#visA canvas') as HTMLCanvasElement;
    const c2d = canvas.getContext('2d')!;
    c2d.fillStyle = '#ff00ff';
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    return true;
  });
  expect(painted).toBe(true);

  const shot = PNG.sync.read(await page.locator('#overlay').screenshot());
  let magenta = 0;
  for (let i = 0; i < shot.data.length; i += 4) {
    if (shot.data[i] > 200 && shot.data[i + 1] < 60 && shot.data[i + 2] > 200) {
      magenta++;
    }
  }
  expect(magenta, 'nothing of the bottom layer shows through').toBe(0);
});
