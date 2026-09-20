import { expect, test } from '@playwright/test';
import { waitForRender } from './drive.js';

/**
 * The shape mark caches triangulated geometry per item. A key shared by two
 * items makes them fight over one entry, so both rebuild every frame and each
 * can read the other's geometry.
 */
test('shape geometry is cached one entry per item', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/test/render/harness.html?spec=choropleth-stroked&renderer=webgpu');
  await waitForRender(page, 90_000);
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

/** A shape item, as the test below reaches into the scenegraph to change one. */
interface StrokeItem {
  marktype?: string;
  items?: StrokeItem[];
  strokeWidth?: number;
  strokeDash?: number[];
  strokeCap?: string;
}

/**
 * The shape mark keeps its outline buffer between frames and rewrites it only
 * when something it is drawn from changed. What decided that was the fill
 * geometry's own inputs, which say nothing about the dash pattern, the cap or
 * the join, so toggling one of those on an existing mark redrew the outline it
 * had before. A cap keeps the segment count, so the length check behind the
 * hold does not catch it either.
 */
test('a shape outline follows a change of stroke cap', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/test/render/harness.html?spec=map-fit-stroked&renderer=webgpu');
  await waitForRender(page, 90_000);
  const out = await page.evaluate(async () => {
    const w = window as unknown as {
      view: { _renderer: Record<string, unknown>; scenegraph: () => { root: StrokeItem } };
      __snapshot: () => Promise<{ rawB64?: string; dataUrl?: string }>;
    };
    const r = w.view._renderer;
    const scene = w.view.scenegraph().root;

    const items: StrokeItem[] = [];
    const seen = new Set<unknown>();
    const walk = (n: StrokeItem) => {
      if (!n || typeof n !== 'object' || seen.has(n)) return;
      seen.add(n);
      if (n.marktype === 'shape') items.push(...(n.items ?? []));
      for (const it of n.items ?? []) {
        for (const c of it.items ?? []) walk(c);
      }
    };
    walk(scene);

    const draw = async () => {
      (r.render as (s: unknown) => unknown).call(r, scene);
      await (r._renderPromise as Promise<void>);
      const shot = await w.__snapshot();
      return shot.rawB64 ?? shot.dataUrl ?? '';
    };

    for (const item of items) {
      item.strokeWidth = 4;
      item.strokeDash = [10, 8];
    }
    const butt = await draw();
    for (const item of items) {
      item.strokeCap = 'round';
    }
    const round = await draw();
    return { items: items.length, drew: butt.length, changed: butt !== round };
  });
  console.log(`shape items ${out.items}, frame ${out.drew} chars, changed ${out.changed}`);
  expect(out.items, 'the spec has to have stroked shapes in it').toBeGreaterThan(100);
  expect(out.drew, 'and the frame has to have been read').toBeGreaterThan(1000);
  expect(out.changed, 'a round cap at every dash end has to reach the frame').toBe(true);
});
