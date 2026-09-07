import { expect, test } from '@playwright/test';

test('buffers are not leaked across renders and renderer swaps', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/test/render/harness.html?spec=jobs&renderer=webgpu');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout: 90_000 },
  );
  const out = await page.evaluate(async () => {
    const counts = { buffers: 0, bufferBytes: 0, destroyed: 0, textures: 0, devices: 0 };
    const origBuf = GPUDevice.prototype.createBuffer;
    GPUDevice.prototype.createBuffer = function (d: GPUBufferDescriptor) {
      counts.buffers++;
      counts.bufferBytes += d.size;
      return origBuf.call(this, d);
    };
    const origTex = GPUDevice.prototype.createTexture;
    GPUDevice.prototype.createTexture = function (d: GPUTextureDescriptor) {
      counts.textures++;
      return origTex.call(this, d);
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
        view: { renderer: (t: string) => unknown; runAsync: () => Promise<unknown>; _renderer: Record<string, unknown> };
      }
    ).view;

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
  expect(before.destroyed / Math.max(before.buffers, 1), 'buffers made before a swap are released').toBeGreaterThan(0.8);
  expect(after.destroyed / Math.max(after.buffers, 1), 'buffers made after a swap are released').toBeGreaterThan(0.8);
});
