import { expect, test } from '@playwright/test';

test('an old build loads with the vega it was written for', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/releases/marks.html?build=1.2.0&view=canvas&mark=rect');
  await page.waitForFunction(
    () => ((window as unknown as { __views?: unknown[] }).__views?.length ?? 0) >= 1,
    undefined,
    {
      timeout: 60_000,
    },
  );
  await page.waitForTimeout(800);
  const out = await page.evaluate(() => ({
    vega: (window as unknown as { vega: { version: string } }).vega.version,
    hasWebgpu: !!(window as unknown as { vega: { renderModule: (s: string) => unknown } }).vega.renderModule('webgpu'),
    build: (document.getElementById('build') as HTMLSelectElement).value,
    banner: document.getElementById('error')!.textContent!.slice(0, 90),
  }));
  console.log(JSON.stringify(out));
  expect(out.vega.startsWith('5.'), `expected vega 5, got ${out.vega}`).toBe(true);
  expect(out.hasWebgpu).toBe(true);
  expect(errors.join(' '), 'no constructor error').not.toContain('without');
});
