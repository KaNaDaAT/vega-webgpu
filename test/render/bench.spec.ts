import { expect, test, type Page } from '@playwright/test';

/**
 * Frame cost for path-heavy scenes, webgpu against canvas. Diagnostic only: it
 * reports and never fails, and is off unless WEBGPU_BENCH is set.
 */
const SPECS = [
  'choropleth',
  'contour-map',
  'tree-radial-bundle',
  'crossfilter',
  'airports',
  'scatter-plot',
  'bar',
  'heatmap',
  'treemap',
  'parallel-coords',
  'arc-diagram',
  'driving',
  'line-curves',
];

interface FrameCost {
  /** Main thread time: building the draws and encoding them. */
  cpu: number;
  /** Including a full GPU drain, which a real render loop does not wait for. */
  total: number;
}

async function bench(page: Page, spec: string, renderer: 'webgpu' | 'canvas', extra = ''): Promise<FrameCost> {
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

    const N = 20;
    const timings = (r.markTimings = {} as Record<string, number>);
    const t0 = performance.now();
    for (let i = 0; i < N; i++) await render.call(r, scene);
    const total = (performance.now() - t0) / N;
    r.markTimings = null;
    // the canvas renderer reports nothing, so its whole frame is main thread
    const cpu = timings['_draw'] === undefined ? total : (timings['_draw'] + (timings['_submit'] ?? 0)) / N;
    return { cpu, total };
  });
}

test('frame cost, webgpu vs canvas', async ({ page }) => {
  test.skip(!process.env.WEBGPU_BENCH, 'set WEBGPU_BENCH=1 to run the benchmark');
  test.setTimeout(600_000);
  const rows: string[] = [];
  for (const spec of SPECS) {
    const wg = await bench(page, spec, 'webgpu');
    const cv = await bench(page, spec, 'canvas');
    const ratio = wg.cpu > 0 ? cv.cpu / wg.cpu : 0;
    const verdict = ratio >= 1 ? `${ratio.toFixed(1)}x faster` : `${(1 / ratio).toFixed(1)}x slower`;
    rows.push(
      `${spec.padEnd(20)} cpu ${wg.cpu.toFixed(2).padStart(6)}   canvas ${cv.cpu.toFixed(2).padStart(6)}   ${verdict}`,
    );
  }
  console.log(['', '=== steady state, main thread ===', ...rows, '=== end ===', ''].join('\n'));
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

/** First frame against steady state, which is what lazy shader and pipeline compilation costs. */
async function firstFrameCost(page: Page, spec: string): Promise<{ first: number; steady: number }> {
  await page.goto(`/test/render/harness.html?spec=${spec}&renderer=webgpu`);
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
    // drop everything compiled so the next frame pays for it again
    const ctx = r._ctx as Record<string, unknown>;
    ctx._shaderCache = {};
    ctx._markCache = {};
    ctx._pipelineCache = {};
    const t0 = performance.now();
    await render.call(r, scene);
    const first = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) await render.call(r, scene);
    return { first, steady: (performance.now() - t1) / 10 };
  });
}

test('first frame against steady state', async ({ page }) => {
  test.skip(!process.env.WEBGPU_BENCH, 'set WEBGPU_BENCH=1 to run the benchmark');
  test.setTimeout(600_000);
  const rows: string[] = [];
  for (const spec of ['symbol-shapes', 'tree-radial-bundle', 'scatter-plot', 'choropleth']) {
    const cost = await firstFrameCost(page, spec);
    rows.push(`${spec.padEnd(20)} first ${cost.first.toFixed(1).padStart(7)}   steady ${cost.steady.toFixed(1)}`);
  }
  console.log(['', '=== shader and pipeline compilation ===', ...rows, '=== end ===', ''].join('\n'));
  expect(rows.length).toBeGreaterThan(0);
});
