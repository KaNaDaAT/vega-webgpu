import { expect, test } from '@playwright/test';

/** Compare and diff drive both views from one set of bound inputs. */
test('bound inputs are shared between the two views', async ({ page }) => {
  test.setTimeout(180_000);
  const errs: string[] = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  page.on('console', m => {
    if (m.type() === 'error') errs.push(m.text().slice(0, 200));
  });

  await page.goto('/test/?spec=tree-radial-bundle&renderer=webgpu&version=dev&compare=1');
  await page.waitForFunction(() => document.querySelectorAll('#panels canvas').length === 2, undefined, {
    timeout: 60_000,
  });
  await page.waitForTimeout(700);
  const dom = await page.evaluate(() => ({
    inHost: document.querySelectorAll('#binds .vega-bind').length,
    elsewhere: document.querySelectorAll('#panels .vega-bind').length,
    hasView: typeof (window as unknown as { view?: unknown }).view !== 'undefined',
  }));
  // moving the shared control has to reach the canvas view as well
  const mirrored = await page.evaluate(async () => {
    const w = window as unknown as {
      view: { signal: (n: string, v?: unknown) => unknown; runAsync: () => Promise<unknown> };
      __compared?: { signal: (n: string, v?: unknown) => unknown }[];
    };
    const canvasView = w.__compared![0];
    const before = canvasView.signal('radius');
    w.view.signal('radius', 137);
    await w.view.runAsync();
    await new Promise(r => setTimeout(r, 400));
    return { before, webgpu: w.view.signal('radius'), canvas: canvasView.signal('radius') };
  });

  console.log(
    'dom:',
    JSON.stringify(dom),
    'mirrored:',
    JSON.stringify(mirrored),
    'errs:',
    JSON.stringify(errs.slice(0, 3)),
  );
  expect(dom.inHost, 'controls live in the shared host').toBeGreaterThan(3);
  expect(dom.elsewhere, 'and nowhere else').toBe(0);
  expect(mirrored.webgpu, 'the webgpu view took the new value').toBe(137);
  expect(mirrored.canvas, 'and the canvas view followed it').toBe(137);
});
