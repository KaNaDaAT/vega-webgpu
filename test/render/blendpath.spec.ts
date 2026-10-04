import { expect, test } from '@playwright/test';
import { harnessUrl, waitForRender } from './drive.js';

/**
 * Which of the two blend paths a fixture takes.
 *
 * multiply and screen over an opaque backdrop fold exactly into the blend
 * state, and that fast path is worth keeping: everything else costs an MSAA
 * resolve, a copy of the frame and two more render passes per draw. Nothing in
 * the pixel comparison notices when it stops being taken, because the slow path
 * is exact too. `_opaqueBackdrop` was read once at initialize, before vega had
 * set the background, so it was false forever and every blended mark paid.
 */
const CASES: { scene: string; offFrame: boolean; why: string }[] = [
  { scene: 'blend-marks', offFrame: false, why: 'multiply over an opaque backdrop is the blend state' },
  { scene: 'blend', offFrame: true, why: 'darken and lighten need the backdrop at any alpha' },
  { scene: 'blend-readback', offFrame: true, why: 'none of these modes are blend state' },
  { scene: 'blend-transparent', offFrame: true, why: 'no background, so every mode needs the backdrop' },
  { scene: 'trail-overlap', offFrame: true, why: 'the trail stroke is composited through a mask' },
  { scene: 'blend-line-last', offFrame: true, why: 'a blended line still open in its batch when the frame ends' },
  { scene: 'line-shapes', offFrame: false, why: 'nothing blends or masks' },
];

test('a frame takes the blend path it should', async ({ page }) => {
  test.setTimeout(180_000);
  for (const { scene, offFrame, why } of CASES) {
    await page.goto(harnessUrl('scene', scene));
    await waitForRender(page);
    const drew = await page.evaluate(() => {
      const r = (window as unknown as { renderer: { drewOffFrame?: () => boolean } }).renderer;
      return r.drewOffFrame?.() ?? null;
    });
    expect(drew, `${scene}: ${why}`).toBe(offFrame);
  }
});
