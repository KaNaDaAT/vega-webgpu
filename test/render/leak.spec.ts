import { expect, test } from '@playwright/test';
import { harnessUrl, waitForRender } from './drive.js';

test('buffers are not leaked across renders and renderer swaps', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(harnessUrl('spec', 'jobs'));
  await waitForRender(page, 90_000);
  const out = await page.evaluate(async () => {
    const counts = { buffers: 0, bufferBytes: 0, destroyed: 0, devices: 0 };
    const origBuf = GPUDevice.prototype.createBuffer;
    GPUDevice.prototype.createBuffer = function (d: GPUBufferDescriptor) {
      counts.buffers++;
      counts.bufferBytes += d.size;
      return origBuf.call(this, d);
    };
    const origDestroy = GPUBuffer.prototype.destroy;
    GPUBuffer.prototype.destroy = function () {
      counts.destroyed++;
      return origDestroy.call(this);
    };
    const origReq = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = function (...a: unknown[]) {
      counts.devices++;
      return origReq.apply(this, a as never);
    };

    const view = (
      window as unknown as {
        view: {
          renderer: (t: string) => unknown;
          runAsync: () => Promise<unknown>;
          _renderer: Record<string, unknown>;
        };
      }
    ).view;

    // vega builds a fresh renderer on every swap back, and it starts from the
    // defaults rather than the options the harness applied to the first one
    const offscreen = () => {
      const options = (view as unknown as { _renderer?: { wgOptions?: { offscreen: boolean } } })._renderer?.wgOptions;
      if (options) {
        options.offscreen = true;
      }
    };

    const snap = () => ({ ...counts });
    const render10 = async () => {
      const r = view._renderer;
      const scene = (view as unknown as { scenegraph: () => { root: unknown } }).scenegraph().root;
      for (let i = 0; i < 10; i++) {
        (r.render as (s: unknown) => unknown).call(r, scene);
        await (r._renderPromise as Promise<void>);
      }
    };

    const start = snap();
    await render10();
    const afterFirst = snap();

    view.renderer('canvas');
    await view.runAsync();
    view.renderer('webgpu');
    offscreen();
    await view.runAsync();
    const afterSwap = snap();

    await render10();
    const afterSecond = snap();

    return {
      per10RendersBefore: {
        buffers: afterFirst.buffers - start.buffers,
        mb: +((afterFirst.bufferBytes - start.bufferBytes) / 1e6).toFixed(1),
        destroyed: afterFirst.destroyed - start.destroyed,
      },
      swap: {
        devicesRequested: afterSwap.devices - afterFirst.devices,
        buffers: afterSwap.buffers - afterFirst.buffers,
      },
      per10RendersAfter: {
        buffers: afterSecond.buffers - afterSwap.buffers,
        mb: +((afterSecond.bufferBytes - afterSwap.bufferBytes) / 1e6).toFixed(1),
        destroyed: afterSecond.destroyed - afterSwap.destroyed,
      },
      totalDevices: afterSecond.devices,
    };
  });
  console.log(JSON.stringify(out, null, 1));
  // Buffers are still made per draw, they just have to be given back. Without
  // that a hovered chart climbed into the gigabytes.
  const before = out.per10RendersBefore;
  const after = out.per10RendersAfter;
  expect(before.destroyed / Math.max(before.buffers, 1), 'buffers made before a swap are released').toBeGreaterThan(
    0.8,
  );
  expect(after.destroyed / Math.max(after.buffers, 1), 'buffers made after a swap are released').toBeGreaterThan(0.8);
  expect(out.swap.buffers, 'the swap itself redraws').toBeGreaterThan(0);
  expect(out.totalDevices, 'and it reuses the device rather than asking for another').toBeLessThanOrEqual(2);
});
