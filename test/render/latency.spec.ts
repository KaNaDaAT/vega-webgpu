import { expect, test } from '@playwright/test';

/**
 * How long a render waits when one is already in flight, which is what an
 * interaction pays when its events arrive faster than a frame.
 */
test('render latency', async ({ page }) => {
  test.skip(!process.env.WEBGPU_BENCH, 'set WEBGPU_BENCH=1 to run the benchmark');
  const rows: string[] = [];
  for (const spec of ['tree-radial-bundle', 'bar', 'scatter-plot']) {
    await page.goto(`/test/render/harness.html?spec=${spec}&renderer=webgpu`);
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
        return w.__renderDone || w.__renderError;
      },
      undefined,
      { timeout: 45_000 },
    );
    const out = await page.evaluate(async () => {
      const w = window as unknown as {
        view?: { _renderer?: Record<string, unknown>; scenegraph: () => { root: unknown } };
      };
      const r = w.view!._renderer!;
      const scene = w.view!.scenegraph().root;
      const render = r.render as (s: unknown) => unknown;
      let worst = 0;
      let total = 0;
      const N = 12;
      for (let i = 0; i < N; i++) {
        render.call(r, scene);
        const t0 = performance.now();
        render.call(r, scene);
        await (r._renderPromise as Promise<void>);
        const dt = performance.now() - t0;
        total += dt;
        worst = Math.max(worst, dt);
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      return { mean: total / N, worst };
    });
    rows.push(
      `${spec.padEnd(20)} mean ${out.mean.toFixed(2).padStart(6)} ms   worst ${out.worst.toFixed(2).padStart(6)} ms`,
    );
  }
  console.log('\n=== deferred render latency ===\n' + rows.join('\n') + '\n=== end ===\n');
  expect(rows.length).toBeGreaterThan(0);
});
