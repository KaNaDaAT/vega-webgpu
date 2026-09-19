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
      // the stage, not the div inside it: hiding the inner one left the
      // stage's padding and checkerboard as a band above the controls
      soloStage: (document.querySelector('#visStage') as HTMLElement).getBoundingClientRect().height,
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
  expect(compare.soloStage, 'the single-render stage takes no space while comparing').toBe(0);
  expect(diff.diffHidden).toBe(false);
  expect(diff.summary).toContain('differ by more than');
  expect(diff.size).toBe(compare.sizes[0]);
  for (const style of ['mask', 'heat', 'over']) {
    expect(styles[style].painted, `${style} paints something`).toBeGreaterThan(0);
  }
  // over keeps the whole chart, the other two only mark what differs. A ratio
  // against the mask does not hold: the mask grows with the difference, and on
  // a software rasterizer that is a tenth of the pixels, while over is capped
  // at the canvas.
  const [w, h] = compare.sizes[0].split('x').map(Number);
  expect(styles.over.painted, 'over covers the whole render').toBeGreaterThan(w * h * 0.9);
  expect(styles.mask.painted, 'the mask marks only what differs').toBeLessThan(styles.over.painted);
});

/**
 * Every control on the demo page starts a load, and a load awaits twice. A
 * second click while the first is still rendering used to run the first one's
 * tail against the second one's state: `disposeAll` clears the view at the top
 * of a load and the next statement that reads it is past an await, so it threw
 * `Cannot read properties of null (reading 'background')` and left the page
 * half set up. Reproduced at a gap of 20 to 50 ms, which is a spec picked while
 * the previous one is still drawing.
 */
test('picking a spec while the last one is still rendering', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));

  await page.goto('/test/?spec=bar&renderer=webgpu&version=dev&offscreen=1');
  await page.waitForTimeout(2500);

  const click = (name: string) =>
    page.evaluate((n: string) => {
      (document.querySelector(`.case[data-spec="${n}"]`) as HTMLElement | null)?.click();
    }, name);

  for (const gap of [5, 20, 50, 90, 200]) {
    await click('choropleth');
    await page.waitForTimeout(gap);
    await click('bar');
    await page.waitForTimeout(1500);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

/**
 * Compare mode reports each renderer's own cost, not one number for the pair.
 * Two views on one page take turns on one thread, so the rate they share and
 * the slower one sets it, but the cpu and gpu columns are per renderer and
 * those are what say which is faster. On the benchmark at a hundred thousand
 * symbols canvas spends about 950 ms of cpu on a render and webgpu about 3,
 * which the single shared FPS of 1 said nothing about.
 */
test('the benchmark reports a cost per renderer', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/test/?spec=benchmark&renderer=webgpu&version=dev&compare=1&diff=0&offscreen=1');
  await page.waitForFunction(() => document.querySelectorAll('#panels canvas').length === 2, undefined, {
    timeout: 60_000,
  });
  // through the bound range, which is the path a reader takes and the one that
  // carries the change to both views
  await page.evaluate(() => {
    const input = document.querySelector('#binds input[type="range"]') as HTMLInputElement | null;
    if (!input) {
      throw new Error('no bound range for N');
    }
    input.value = '40000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(5000);
  const text = await page.evaluate(() => document.querySelector('#fpsDisplay')?.textContent ?? '');
  console.log('BENCH ' + text);

  expect(text, 'both renderers should be listed').toContain('canvas');
  expect(text).toContain('webgpu');
  const cpus = [...text.matchAll(/cpu ([0-9.]+)ms/g)].map(m => Number(m[1]));
  expect(cpus, 'a cpu figure for each').toHaveLength(2);
  expect(cpus[1], `webgpu cpu ${cpus[1]} should be under canvas ${cpus[0]} on a heavy scene`).toBeLessThan(cpus[0]);
});

/**
 * Two views on one page take turns on one thread and vega's timers all fire in
 * one animation frame, so the pair advances in lockstep and the slower one sets
 * the pace. The run control holds one still so the other can be watched at its
 * own speed: on the benchmark at forty thousand symbols, on a real adapter,
 * both read 9 renders a second and holding the canvas one takes the webgpu one
 * to 60. This checks the mechanism rather than the ratio, since the suite runs
 * on a software adapter where the ratio is the other way round.
 */
test('the run control holds one view still', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/test/?spec=benchmark&renderer=webgpu&version=dev&compare=1&diff=0&offscreen=1');
  await page.waitForFunction(
    () => (window as unknown as { __compared?: unknown[] }).__compared?.length === 2,
    undefined,
    { timeout: 60_000 },
  );

  const rates = async () => {
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.querySelector('#fpsDisplay')?.textContent ?? '');
    const found = [...text.matchAll(/(canvas|webgpu) (\d+)/g)];
    return Object.fromEntries(found.map(m => [m[1], Number(m[2])])) as Record<string, number>;
  };
  const pick = (value: string) =>
    page.evaluate((v: string) => {
      const sel = document.querySelector('#drive') as HTMLSelectElement;
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);

  const both = await rates();
  expect(both.canvas, 'both should be drawing').toBeGreaterThan(0);
  expect(both.webgpu).toBeGreaterThan(0);

  await pick('webgpu');
  const soloB = await rates();
  expect(soloB.canvas, 'the held view should stop').toBe(0);
  expect(soloB.webgpu).toBeGreaterThan(0);

  await pick('canvas');
  const soloA = await rates();
  expect(soloA.webgpu, 'and the other way round').toBe(0);
  expect(soloA.canvas).toBeGreaterThan(0);

  await pick('both');
  const again = await rates();
  expect(again.canvas, 'and both come back').toBeGreaterThan(0);
  expect(again.webgpu).toBeGreaterThan(0);
});
