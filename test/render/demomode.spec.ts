import { expect, test } from '@playwright/test';

/** The demo page's compare and diff views. */
test('compare and diff checkboxes', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto('/test/?spec=choropleth&renderer=webgpu&version=dev&compare=1&offscreen=1');
  await page.waitForFunction(() => document.querySelectorAll('#panels canvas').length === 2, undefined, {
    timeout: 60_000,
  });
  const compare = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('#panels canvas')] as HTMLCanvasElement[];
    return {
      count: cs.length,
      sizes: cs.map(c => `${c.width}x${c.height}`),
      panelsHidden: !!document.querySelector('#panels')?.hasAttribute('hidden'),
    };
  });

  await page.goto('/test/?spec=choropleth&renderer=webgpu&version=dev&diff=1&offscreen=1');
  await page.waitForFunction(() => (document.querySelector('#diffSummary')?.textContent ?? '').length > 0, undefined, {
    timeout: 60_000,
  });
  const diff = await page.evaluate(() => {
    const c = document.querySelector('#diffCanvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let painted = 0;
    for (let i = 3; i < d.data.length; i += 4) if (d.data[i] > 0) painted++;
    return {
      summary: document.querySelector('#diffSummary')?.textContent ?? '',
      size: `${c.width}x${c.height}`,
      painted,
      diffHidden: !!document.querySelector('#diffPanel')?.hasAttribute('hidden'),
    };
  });

  // every diff style has to paint something, and over keeps the chart under it
  const styles = await page.evaluate(async () => {
    const out: Record<string, { painted: number; opaque: number }> = {};
    const sel = document.querySelector('#diffStyle') as HTMLSelectElement;
    for (const style of ['mask', 'heat', 'over']) {
      sel.value = style;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      const c = document.querySelector('#diffCanvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      let painted = 0;
      let opaque = 0;
      for (let i = 3; i < d.data.length; i += 4) {
        if (d.data[i] > 0) painted++;
        if (d.data[i] === 255) opaque++;
      }
      out[style] = { painted, opaque };
    }
    return out;
  });

  console.log('compare:', JSON.stringify(compare));
  console.log('styles:', JSON.stringify(styles));
  console.log('diff:', JSON.stringify(diff));
  expect(errors, 'page errors').toEqual([]);
  expect(compare.count, 'compare shows two canvases').toBe(2);
  expect(compare.sizes[0]).toBe(compare.sizes[1]);
  expect(compare.panelsHidden).toBe(false);
  expect(diff.diffHidden).toBe(false);
  expect(diff.summary).toContain('differ by more than');
  expect(diff.size).toBe(compare.sizes[0]);
  for (const style of ['mask', 'heat', 'over']) {
    expect(styles[style].painted, `${style} paints something`).toBeGreaterThan(0);
  }
  // over keeps the whole chart, the other two only mark what differs
  expect(styles.over.painted).toBeGreaterThan(styles.mask.painted * 10);
});
