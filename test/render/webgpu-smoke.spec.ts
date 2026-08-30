import { expect, test } from '@playwright/test';

/**
 * Fail-fast gate for CI. If the browser cannot bring up a WebGPU adapter, e.g.
 * the runner launched the lightweight headless shell instead of full Chromium,
 * or the SwiftShader flags are missing, then every spec in the suite fails
 * with a confusing renderer mismatch. This one focused test renders a single
 * spec and asserts WebGPU actually ran, surfacing the real cause. In CI it runs
 * as its own step before the full suite so the job stops early and clearly.
 */
test('WebGPU adapter renders a spec', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(String(err)));

  await page.goto('/test/render/harness.html?spec=bar&renderer=webgpu');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout: 45_000 },
  );

  const state = await page.evaluate(() => {
    const w = window as unknown as { __renderError?: string; __rendererKind?: string };
    return { error: w.__renderError, kind: w.__rendererKind ?? 'unknown' };
  });

  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
  expect(state.error, `harness error:\n${state.error}`).toBeUndefined();
  expect(
    state.kind,
    `WebGPU did not render (got '${state.kind}'). On CI the browser must be full ` +
      `Chromium (not the headless shell) launched with the SwiftShader WebGPU flags.`,
  ).toBe('webgpu');
});
