import { expect, test } from '@playwright/test';

/** After a drag stops, one more frame redraws the labels at full quality. */
test('settle after drag', async ({ page }) => {
  await page.goto('/test/render/harness.html?spec=tree-radial-bundle&renderer=webgpu');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout: 45_000 },
  );
  const out = await page.evaluate(async () => {
    const view = (
      window as unknown as {
        view: {
          signal: (n: string, v?: unknown) => unknown;
          runAsync: () => Promise<unknown>;
          _renderer: Record<string, unknown>;
        };
      }
    ).view;
    const r = view._renderer;
    let renders = 0;
    const orig = r._render as (...a: unknown[]) => unknown;
    const settles: boolean[] = [];
    r._render = function (this: unknown, ...args: unknown[]) {
      renders++;
      settles.push(args[2] === true);
      return orig.apply(this, args);
    };
    for (let i = 0; i < 10; i++) {
      view.signal('rotate', 40 + i * 5);
      await view.runAsync();
    }
    const during = renders;
    const settledDuring = settles.filter(Boolean).length;
    await new Promise(res => setTimeout(res, 500));
    return { during, after: renders, settledDuring, settledAfter: settles.filter(Boolean).length };
  });
  console.log(JSON.stringify(out));
  expect(out.after).toBeGreaterThan(out.during);
  expect(out.settledAfter).toBeGreaterThan(out.settledDuring);
});
