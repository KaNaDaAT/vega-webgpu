import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { installGpuProbe } from './gpu-probe.js';
import { shotToPng, type Shot } from './snapshot.js';

/**
 * Fail-fast gate for CI. If the browser cannot bring up a WebGPU adapter, e.g.
 * the runner launched the lightweight headless shell instead of full Chromium,
 * or the SwiftShader flags are missing, then every spec in the suite fails
 * with a confusing renderer mismatch. This one focused test renders a single
 * spec and asserts WebGPU actually ran, surfacing the real cause. In CI it runs
 * as its own step before the full suite so the job stops early and clearly.
 *
 * It also asserts the captured frame contains pixels. A renderer that comes up
 * but reads back an empty image passes every other check here and then fails
 * the whole suite on the pixel diff instead.
 *
 * Every assertion carries the same diagnostic block, since whichever one fires
 * first is the only output a CI run gets.
 */
test('WebGPU adapter renders a spec', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(String(err)));
  // the renderer reports device loss and adapter problems through console.warn
  const logs: string[] = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));

  await installGpuProbe(page);
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
    const w = window as unknown as {
      __renderError?: string;
      __rendererKind?: string;
      __traces?: string[];
      view?: { _renderer?: Record<string, unknown> };
    };
    const r = w.view?._renderer;
    const device = typeof r?.device === 'function' ? (r.device as () => unknown)() : null;
    return {
      error: w.__renderError,
      kind: w.__rendererKind ?? 'unknown',
      traces: w.__traces ?? [],
      deviceLostReason: (r?.deviceLostReason as string | null) ?? null,
      deviceGeneration: (r?.deviceGeneration as number) ?? 0,
      hasDevice: !!device,
      gpuLog: (w as unknown as { __gpuLog?: string[] }).__gpuLog ?? [],
    };
  });

  const detail = [
    `rendererKind: ${state.kind}`,
    `deviceLost: ${state.deviceLostReason ?? 'no'}`,
    `devicesCreated: ${state.deviceGeneration}`,
    `hasDevice: ${state.hasDevice}`,
    `traces:\n${state.traces.join('\n')}`,
    `gpu timeline:\n${state.gpuLog.join('\n')}`,
    `console:\n${logs.join('\n')}`,
  ].join('\n');

  expect(errors, `page errors:\n${errors.join('\n')}\n${detail}`).toEqual([]);
  expect(state.error, `harness error:\n${state.error}\n${detail}`).toBeUndefined();
  expect(
    state.kind,
    `WebGPU did not render (got '${state.kind}'). On CI the browser must be full ` +
      `Chromium (not the headless shell) launched with the SwiftShader WebGPU flags.\n${detail}`,
  ).toBe('webgpu');

  const shot: Shot | null = await page.evaluate(async () => {
    const w = window as unknown as { __snapshot?: () => Promise<unknown> };
    return ((await w.__snapshot?.()) ?? null) as Shot | null;
  });
  expect(shot, `could not snapshot the canvas\n${detail}`).toBeTruthy();

  const img = PNG.sync.read(shotToPng(shot as Shot));
  let painted = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] > 8) {
      painted++;
    }
  }
  const after = await page.evaluate(() => (window as unknown as { __traces?: string[] }).__traces ?? []);
  expect(
    painted / (img.width * img.height),
    `the capture is empty (${img.width}x${img.height}, ${painted} painted pixels).\n${detail}\n` +
      `traces after capture:\n${after.join('\n')}`,
  ).toBeGreaterThan(0.05);
});
