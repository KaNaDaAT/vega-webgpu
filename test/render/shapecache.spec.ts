import { expect, test } from '@playwright/test';

/**
 * The shape mark caches triangulated geometry per item. A key shared by two
 * items makes them fight over one entry, so both rebuild every frame and each
 * can read the other's geometry.
 */
test('shape geometry is cached one entry per item', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/test/render/harness.html?spec=choropleth-stroked&renderer=webgpu');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout: 90_000 },
  );
  const out = await page.evaluate(async () => {
    const view = (
      window as unknown as { view: { _renderer: Record<string, unknown>; scenegraph: () => { root: unknown } } }
    ).view;
    const r = view._renderer;
    const scene = view.scenegraph().root;
    (r.render as (s: unknown) => unknown).call(r, scene);
    await (r._renderPromise as Promise<void>);

    let items = 0;
    const seen = new Set<unknown>();
    const walk = (n: { marktype?: string; items?: unknown[] }) => {
      if (!n || typeof n !== 'object' || seen.has(n)) return;
      seen.add(n);
      if (n.marktype === 'shape') items += n.items?.length ?? 0;
      for (const it of (n.items ?? []) as { items?: unknown[] }[]) {
        for (const c of (it.items ?? []) as never[]) walk(c);
      }
    };
    walk(scene as never);

    const res = (r._ctx as { _markCache: Record<string, { cache?: Map<unknown, unknown> }> })._markCache.shape;
    return { items, entries: res?.cache?.size ?? -1 };
  });
  console.log(`shape items ${out.items}, cache entries ${out.entries}`);
  expect(out.items).toBeGreaterThan(1000);
  expect(out.entries, 'every item needs its own entry, or they rebuild every frame').toBe(out.items);
});
