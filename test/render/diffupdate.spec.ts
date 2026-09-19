import { expect, test } from '@playwright/test';
import { renderDpr } from './specs.js';

/** The diff has to follow whatever the two views do, including a resize. */
test('the diff keeps up with a resize', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/test/?spec=bar&renderer=webgpu&version=dev&diff=1&offscreen=1');
  await page.waitForFunction(() => (document.querySelector('#diffSummary')?.textContent ?? '').length > 0, undefined, {
    timeout: 60_000,
  });
  const out = await page.evaluate(async () => {
    const w = window as unknown as {
      view: { width: (n?: number) => unknown; height: (n?: number) => unknown; runAsync: () => Promise<unknown> };
      __compared: {
        width: (n?: number) => unknown;
        height: (n?: number) => unknown;
        runAsync: () => Promise<unknown>;
      }[];
    };
    const snap = () => {
      const c = document.querySelector('#diffCanvas') as HTMLCanvasElement;
      const panels = [...document.querySelectorAll('#panels canvas')] as HTMLCanvasElement[];
      return {
        size: `${c.width}x${c.height}`,
        views: panels.map(p => `${p.width}x${p.height}`),
        summary: document.querySelector('#diffSummary')!.textContent ?? '',
      };
    };
    const steps = [snap()];

    // resize both views the way the page would
    for (const wdt of [700, 350]) {
      for (const v of w.__compared) {
        v.width(wdt);
        await v.runAsync();
      }
      await new Promise(r => setTimeout(r, 700));
      steps.push(snap());
    }
    return steps;
  });
  console.log(JSON.stringify(out, null, 1));
  expect(out[1].size, 'diff follows the first resize').not.toBe(out[0].size);
  expect(out[2].size, 'and the second').not.toBe(out[1].size);
  // a new size on its own says nothing: it has to be the size the views are at,
  // and the two have to still agree once they are redrawn there
  for (const step of out) {
    expect(step.views[0], `both views are one size at ${step.size}`).toBe(step.views[1]);
    expect(step.size, 'and the diff is drawn at that size').toBe(step.views[0]);
    const ratio = Number(step.summary.match(/\(([\d.]+)%\)/)![1]);
    expect(ratio, `the two still agree at ${step.size}`).toBeLessThan(1);
  }
});

/**
 * Browser zoom changes devicePixelRatio without resizing the view. Both
 * renderers have to follow it, or the diff has two different sizes and nothing
 * to compare.
 */
test('the diff keeps up with a zoom', async ({ page }) => {
  test.setTimeout(180_000);
  // Emulation.setDeviceMetricsOverride flips what a resolution query matches
  // but fires no change event, which a real zoom does, so the test hands the
  // event to whoever is listening
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    const seen: MediaQueryList[] = [];
    (window as unknown as { __mqs: MediaQueryList[] }).__mqs = seen;
    window.matchMedia = (q: string) => {
      const m = real(q);
      seen.push(m);
      return m;
    };
  });
  await page.goto('/test/?spec=bar&renderer=webgpu&version=dev&diff=1&offscreen=1');
  await page.waitForFunction(() => (document.querySelector('#diffSummary')?.textContent ?? '').length > 0, undefined, {
    timeout: 60_000,
  });
  const probe = () =>
    page.evaluate(() => {
      const canvases = [...document.querySelectorAll('#panels canvas')] as HTMLCanvasElement[];
      const diff = document.querySelector('#diffCanvas') as HTMLCanvasElement;
      const px = canvases[0].getContext('2d')!.getImageData(0, 0, canvases[0].width, canvases[0].height).data;
      let opaque = 0;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] !== 0) opaque++;
      }
      return {
        dpr: window.devicePixelRatio,
        sizes: canvases.map(c => `${c.width}x${c.height}`),
        diffSize: `${diff.width}x${diff.height}`,
        summary: document.querySelector('#diffSummary')!.textContent!,
        // a resized canvas that was never redrawn is transparent, which the
        // diff would report as the whole picture disagreeing
        canvasCovered: opaque / (canvases[0].width * canvases[0].height),
      };
    });

  const before = await probe();
  const view = page.viewportSize() ?? { width: 1280, height: 720 };
  // The suite can already be running at a ratio, and zooming to the one it is
  // on changes nothing, so every assertion below would pass having tested it
  const target = renderDpr === 2 ? 3 : 2;
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setDeviceMetricsOverride', { ...view, deviceScaleFactor: target, mobile: false });
  await page.evaluate(() => {
    // a handler registers the next query, so take a copy or this never ends
    const seen = (window as unknown as { __mqs: MediaQueryList[] }).__mqs;
    for (const m of seen.splice(0)) {
      m.dispatchEvent(new Event('change'));
    }
  });
  await page.waitForTimeout(1500);
  const after = await probe();
  await client.send('Emulation.clearDeviceMetricsOverride');
  console.log(JSON.stringify({ before, after }, null, 1));

  expect(after.dpr, 'the zoom took').toBe(target);
  expect(after.sizes[0], 'both views end on the same ratio').toBe(after.sizes[1]);
  expect(after.sizes[0], 'and it is the zoomed one').not.toBe(before.sizes[0]);
  expect(after.diffSize, 'the diff is drawn at that size').toBe(after.sizes[0]);
  expect(after.canvasCovered, 'the canvas view redrew rather than just clearing').toBeCloseTo(before.canvasCovered, 2);
  const ratio = Number(after.summary.match(/\(([\d.]+)%\)/)![1]);
  expect(ratio, 'and the two still agree').toBeLessThan(1);
});

/**
 * Reading the webgpu frame draws it, and the diff is driven by draws, so the
 * two fed each other: every diff asked for a capture, the capture rendered, the
 * render asked for another diff. On a settled spec nothing should be drawing at
 * all, and the numbers on screen should stop moving.
 */
test('the diff does not keep redrawing a settled spec', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/test/?spec=autosize-fit&renderer=webgpu&version=dev&compare=0&diff=1&offscreen=1');
  await page.waitForFunction(() => (document.querySelector('#diffSummary')?.textContent ?? '').length > 0, undefined, {
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);

  const out = await page.evaluate(async () => {
    const views = (window as unknown as { __compared: { _renderer: Record<string, unknown> }[] }).__compared;
    let renders = 0;
    for (const v of views) {
      const r = v._renderer;
      const inner = (r._render as (...a: unknown[]) => unknown).bind(r);
      r._render = (...a: unknown[]) => {
        renders++;
        return inner(...a);
      };
    }
    const first = document.querySelector('#diffSummary')!.textContent;
    await new Promise(res => setTimeout(res, 2500));
    return { renders, first, last: document.querySelector('#diffSummary')!.textContent };
  });

  console.log(JSON.stringify(out));
  expect(out.renders, 'a settled spec redraws for nobody').toBe(0);
  expect(out.last, 'so the numbers stay put').toBe(out.first);
});
