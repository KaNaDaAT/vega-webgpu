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
    const acc = await bench(page, spec, 'webgpu', '&renderBatch=0');
    const cv = await bench(page, spec, 'canvas');
    const ratio = wg.cpu > 0 ? cv.cpu / wg.cpu : 0;
    const verdict = ratio >= 1 ? `${ratio.toFixed(1)}x faster` : `${(1 / ratio).toFixed(1)}x slower`;
    rows.push(
      `${spec.padEnd(20)} cpu ${wg.cpu.toFixed(2).padStart(6)}  accumulated ${acc.cpu.toFixed(2).padStart(6)}   canvas ${cv.cpu.toFixed(2).padStart(6)}   ${verdict}`,
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

/** First frame against steady state, which is what lazy pipeline compilation costs. */
async function firstFrameCost(
  page: Page,
  spec: string,
  warm = false,
): Promise<{ first: number; steady: number; warmMs: number }> {
  await page.addInitScript(w => {
    (globalThis as unknown as { __warm?: boolean }).__warm = w;
  }, warm);
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
    // drop every compiled pipeline so the next frame pays for them again
    (r._ctx as Record<string, unknown>)._markCache = {};
    (r._ctx as Record<string, unknown>)._pipelineCache = {};
    const warmed = (globalThis as unknown as { __warm?: boolean }).__warm === true;
    void warmed;
    let warmMs = 0;
    if (warmed) {
      const warm = r.warmMarks as (t: string[]) => void;
      const tw = performance.now();
      // only the marks this scene actually contains
      const seen = new Set<string>();
      const walk = (n: Record<string, unknown>) => {
        if (typeof n.marktype === 'string') seen.add(n.marktype);
        for (const it of (n.items as Record<string, unknown>[]) ?? [])
          for (const m of (it.items as Record<string, unknown>[]) ?? []) walk(m);
      };
      walk(scene as Record<string, unknown>);
      warm.call(r, [...seen]);
      warmMs = performance.now() - tw;
    }
    const t0 = performance.now();
    await render.call(r, scene);
    const first = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) await render.call(r, scene);
    return { first, steady: (performance.now() - t1) / 10, warmMs };
  });
}

test('first frame against steady state', async ({ page }) => {
  test.skip(!process.env.WEBGPU_BENCH, 'set WEBGPU_BENCH=1 to run the benchmark');
  test.setTimeout(600_000);
  const rows: string[] = [];
  for (const spec of ['symbol-shapes', 'tree-radial-bundle', 'scatter-plot', 'choropleth']) {
    const cold = await firstFrameCost(page, spec, false);
    const hot = await firstFrameCost(page, spec, true);
    rows.push(
      `${spec.padEnd(20)} cold first ${cold.first.toFixed(1).padStart(7)}   warmed first ${hot.first.toFixed(1).padStart(7)} (warm took ${hot.warmMs.toFixed(2)})   steady ${cold.steady.toFixed(1)}`,
    );
  }
  console.log(['', '=== pipeline compilation ===', ...rows, '=== end ===', ''].join('\n'));
  expect(rows.length).toBeGreaterThan(0);
});

test('pipeline compilation cost per mark', async ({ page }) => {
  test.skip(!process.env.WEBGPU_BENCH, 'set WEBGPU_BENCH=1 to run the benchmark');
  test.setTimeout(600_000);
  await page.goto('/test/render/harness.html?spec=bar&renderer=webgpu');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout: 45_000 },
  );
  const out = await page.evaluate(() => {
    const w = window as unknown as { view?: { _renderer?: Record<string, unknown> } };
    const r = w.view!._renderer!;
    const warm = r.warmMarks as (t: string[]) => void;
    const types = ['rect', 'text', 'rule', 'group', 'symbol', 'line', 'path', 'area', 'shape', 'arc', 'image'];
    const rows: [string, number][] = [];
    for (const t of types) {
      (r._ctx as Record<string, unknown>)._markCache = {};
      (r._ctx as Record<string, unknown>)._pipelineCache = {};
      const t0 = performance.now();
      warm.call(r, [t]);
      rows.push([t, Math.round((performance.now() - t0) * 100) / 100]);
    }
    // and the whole set together, sharing the pipeline cache
    (r._ctx as Record<string, unknown>)._markCache = {};
    (r._ctx as Record<string, unknown>)._pipelineCache = {};
    const t0 = performance.now();
    warm.call(r, types);
    const all = Math.round((performance.now() - t0) * 100) / 100;
    return { rows, all };
  });
  const lines = out.rows.sort((a, b) => b[1] - a[1]).map(([t, ms]) => `  ${t.padEnd(8)} ${String(ms).padStart(7)} ms`);
  console.log(
    [
      '',
      '=== compilation per mark ===',
      ...lines,
      `  ${'ALL'.padEnd(8)} ${String(out.all).padStart(7)} ms`,
      '=== end ===',
      '',
    ].join('\n'),
  );
  expect(out.all).toBeGreaterThan(0);
});
