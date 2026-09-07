import { expect, test } from '@playwright/test';

/**
 * Splits a benchmark frame into vega's dataflow and the renderer's own work, so
 * a slow frame can be attributed rather than guessed at. Reports and never
 * fails, and is off unless WEBGPU_BENCH is set.
 */
test('benchmark frame split', async ({ page }) => {
  test.skip(!process.env.WEBGPU_BENCH, 'set WEBGPU_BENCH=1 to run the benchmark');
  test.setTimeout(300_000);
  await page.goto('/test/render/harness.html?spec=benchmark&renderer=webgpu');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout: 60_000 },
  );
  const rows = await page.evaluate(async () => {
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

    let renderMs = 0;
    const inner = (r.renderAsync as (...a: unknown[]) => Promise<unknown>).bind(r);
    r.renderAsync = async function (...args: unknown[]) {
      const t0 = performance.now();
      const out = await inner(...args);
      renderMs += performance.now() - t0;
      return out;
    };

    const out: string[] = [];
    for (const N of [10000, 50000, 100000, 300000]) {
      view.signal('N', N);
      await view.runAsync();
      await view.runAsync();

      r.markTimings = {};
      renderMs = 0;
      const K = 8;
      const t0 = performance.now();
      for (let i = 0; i < K; i++) {
        view.signal('t', 100 + i * 0.05);
        await view.runAsync();
      }
      const total = (performance.now() - t0) / K;
      const render = renderMs / K;
      const mt = r.markTimings as Record<string, number>;
      const gpu = (r.gpuFrameTime as number) ?? 0;
      out.push(
        `N=${String(N).padStart(6)}  frame ${total.toFixed(1).padStart(6)}  ` +
          `vega ${(total - render).toFixed(1).padStart(6)}  renderAsync ${render.toFixed(1).padStart(5)}  ` +
          `draw ${((mt._draw ?? 0) / K).toFixed(1)}  symbol ${((mt.symbol ?? 0) / K).toFixed(1)}  ` +
          `submit ${((mt._submit ?? 0) / K).toFixed(1)}  gpu ${gpu.toFixed(2)}`,
      );
    }
    return out;
  });
  console.log('\n' + rows.join('\n') + '\n');
  expect(rows.length).toBeGreaterThan(0);
});
