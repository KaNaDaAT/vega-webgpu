import { expect, test } from '@playwright/test';
import { harnessUrl, waitForRender, type Capture, type HarnessWindow } from './drive.js';

/** Browser zoom changes devicePixelRatio without resizing the view. */
test('redraws when the pixel ratio changes', async ({ page }) => {
  await page.goto(harnessUrl('spec', 'bar'));
  await waitForRender(page, 45_000);
  const out = await page.evaluate(async () => {
    const r = (window as unknown as { view: { _renderer: Record<string, unknown> } }).view._renderer;
    const canvas = r._canvas as HTMLCanvasElement;
    const capture = r.captureFrame as () => Promise<Capture>;
    const ink = (window as unknown as HarnessWindow).__ink;
    // The watcher is replaced on every change, so it is read fresh each time.
    const watcher = () => r._dpr as { query: MediaQueryList; onChange: () => void } | null;
    const watching = watcher() !== null;
    const media = watcher()?.query.media;
    const set = (v: number) => Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: v });

    // Start from a known ratio rather than whatever the run is at, or RENDER_DPR
    // decides the numbers below and a 2x run compares 2 against 2.
    set(1);
    watcher()?.onChange();
    await new Promise(res => setTimeout(res, 400));
    const before = { w: canvas.width, h: canvas.height, ink: ink(await capture.call(r)) };

    set(2);
    watcher()?.onChange();
    await new Promise(res => setTimeout(res, 400));
    const shot = await capture.call(r);
    return {
      watching,
      media,
      before,
      after: { w: canvas.width, h: canvas.height, ink: ink(shot) },
      nextMedia: (r._dpr as { query: MediaQueryList }).query.media,
    };
  });
  console.log(JSON.stringify(out));
  expect(out.watching).toBe(true);
  expect(out.after.w).toBe(out.before.w * 2);
  expect(out.after.h).toBe(out.before.h * 2);
  // the redraw put the same picture back, at twice the pixels
  expect(out.before.ink).toBeGreaterThan(0.02);
  expect(Math.abs(out.after.ink - out.before.ink)).toBeLessThan(0.02);
  expect(out.nextMedia).toBe('(resolution: 2dppx)');
});
