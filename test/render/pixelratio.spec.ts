import { expect, test } from '@playwright/test';

/** The canvas has to stay inside the GPU's texture cap, and may hold its ratio. */
test('pixel ratio is capped and can be locked', async ({ page }) => {
  test.setTimeout(120_000);
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
    const ctx = r._ctx as { _ratio: number };
    const origin = r._origin as number[];
    const resize = (w: number, h: number) =>
      (r.resize as (w: number, h: number, o: readonly number[]) => unknown).call(r, w, h, origin);

    const limit = r._maxTextureDim as number;
    const set = (v: number) => Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: v });
    const dpr0 = window.devicePixelRatio;

    // 1. a view that fits keeps the full ratio
    set(2);
    resize(400, 300);
    const fits = { ratio: ctx._ratio, w: canvas.width };

    // 2. a view past the cap drops to a ratio that fits, instead of going blank
    const tooWide = limit; // limit css px at 2x needs 2 * limit device px
    resize(tooWide, 300);
    const capped = { ratio: ctx._ratio, w: canvas.width, withinLimit: canvas.width <= limit };

    // 3. with redrawOnZoom off the ratio is held across a zoom change
    const opts = r.wgOptions as Record<string, unknown>;
    resize(400, 300);
    opts.redrawOnZoom = false;
    r._lockedRatio = null;
    resize(400, 300);
    const before = ctx._ratio;
    set(3);
    resize(400, 300);
    const locked = { before, after: ctx._ratio, watching: r._dpr !== null };

    // 4. back on, the ratio follows zoom again
    opts.redrawOnZoom = true;
    r._lockedRatio = null;
    resize(400, 300);
    const follows = { ratio: ctx._ratio, watching: r._dpr !== null };

    set(dpr0);
    opts.redrawOnZoom = true;
    r._lockedRatio = null;
    resize(400, 300);
    return { limit, fits, capped, locked, follows };
  });
  console.log(JSON.stringify(out, null, 1));

  expect(out.fits.ratio, 'a view that fits keeps its ratio').toBe(2);
  expect(out.capped.withinLimit, 'a huge view stays inside the cap').toBe(true);
  expect(out.capped.ratio, 'and drops below the requested 2x').toBeLessThan(2);
  expect(out.capped.ratio, 'without collapsing to nothing').toBeGreaterThan(0);
  expect(out.locked.after, 'a locked ratio ignores a zoom change').toBe(out.locked.before);
  expect(out.locked.watching, 'and stops watching for one').toBe(false);
  expect(out.follows.ratio, 'following again picks the new ratio up').toBe(3);
  expect(out.follows.watching, 'and watches again').toBe(true);
});
