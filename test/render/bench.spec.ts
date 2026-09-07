import { expect, test, type Page } from '@playwright/test';

/**
 * Frame cost for path-heavy scenes, webgpu against canvas. Diagnostic only: it
 * reports and never fails, and is off unless WEBGPU_BENCH is set.
 */
const SPECS = ['choropleth', 'airports', 'contour-map', 'tree-radial-bundle', 'crossfilter'];

async function bench(page: Page, spec: string, renderer: 'webgpu' | 'canvas', extra = ''): Promise<number> {
  await page.goto(`/test/render/harness.html?spec=${spec}&renderer=${renderer}${extra}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout: 45_000 },
  );
  return page.evaluate(async () => {
    const w = window as unknown as {
      view?: { _renderer?: Record<string, unknown>; scenegraph: () => { root: unknown } };
    };
    const r = w.view!._renderer!;
    const scene = w.view!.scenegraph().root;
    const render = r.renderAsync as (s: unknown) => Promise<unknown>;
    for (let i = 0; i < 3; i++) await render.call(r, scene);
    const t0 = performance.now();
    const N = 20;
    for (let i = 0; i < N; i++) await render.call(r, scene);
    return (performance.now() - t0) / N;
  });
}

test('frame cost, webgpu vs canvas', async ({ page }) => {
  test.skip(!process.env.WEBGPU_BENCH, 'set WEBGPU_BENCH=1 to run the benchmark');
  test.setTimeout(600_000);
  const rows: string[] = [];
  for (const spec of SPECS) {
    const wg = await bench(page, spec, 'webgpu');
    const cached = await bench(page, spec, 'webgpu', '&cacheShapes=1');
    const cv = await bench(page, spec, 'canvas');
    rows.push(
      `${spec.padEnd(20)} webgpu ${wg.toFixed(2).padStart(7)}  cacheShapes ${cached.toFixed(2).padStart(7)}  canvas ${cv.toFixed(2).padStart(6)} ms`,
    );
  }
  console.log(`\n=== frame cost ===\n${rows.join('\n')}\n=== end ===\n`);
  expect(rows.length).toBe(SPECS.length);
});

test('per-mark draw cost', async ({ page }) => {
  test.skip(!process.env.WEBGPU_BENCH, 'set WEBGPU_BENCH=1 to run the benchmark');
  test.setTimeout(600_000);
  const rows: string[] = [];
  for (const spec of SPECS) {
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
      const render = r.renderAsync as (s: unknown) => Promise<unknown>;
      for (let i = 0; i < 3; i++) await render.call(r, scene);
      r.markTimings = {};
      const t0 = performance.now();
      const N = 10;
      for (let i = 0; i < N; i++) await render.call(r, scene);
      const total = (performance.now() - t0) / N;
      const timings = r.markTimings as Record<string, number>;
      const per: Record<string, number> = {};
      for (const k of Object.keys(timings)) per[k] = Math.round((timings[k] / N) * 100) / 100;
      r.markTimings = null;
      return { total: Math.round(total * 100) / 100, per };
    });
    const parts = Object.entries(out.per)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join('  ');
    rows.push(`${spec.padEnd(20)} total ${String(out.total).padStart(7)} ms   marks: ${parts}`);
  }
  console.log('\n=== per-mark draw cost ===\n' + rows.join('\n') + '\n=== end ===\n');
  expect(rows.length).toBe(SPECS.length);
});
