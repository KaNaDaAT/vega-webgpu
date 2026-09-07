import { expect, test } from '@playwright/test';

/** Browser zoom changes devicePixelRatio without resizing the view. */
test('redraws when the pixel ratio changes', async ({ page }) => {
  await page.goto('/test/render/harness.html?spec=bar&renderer=webgpu');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout: 45_000 },
  );
  const out = await page.evaluate(async () => {
    const r = (window as unknown as { view: { _renderer: Record<string, unknown> } }).view._renderer;
    const canvas = r._canvas as HTMLCanvasElement;
    const capture = r.captureFrame as () => Promise<{ width: number; height: number; data: Uint8Array }>;
    // composite over white first: an untouched pixel reads as opaque black
    const ink = (shot: { width: number; height: number; data: Uint8Array }) => {
      let n = 0;
      for (let i = 0; i < shot.data.length; i += 4) {
        const a = shot.data[i + 3] / 255;
        for (let c = 0; c < 3; c++) {
          if (shot.data[i + c] * a + 255 * (1 - a) < 240) {
            n++;
            break;
          }
        }
      }
      return n / (shot.width * shot.height);
    };
    const before = { w: canvas.width, h: canvas.height, ink: ink(await capture.call(r)) };

    const watcher = r._dpr as { query: MediaQueryList; onChange: () => void } | null;
    const watching = watcher !== null;
    const media = watcher?.query.media;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    watcher?.onChange();
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
