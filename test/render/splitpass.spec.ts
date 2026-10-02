import { expect, test } from '@playwright/test';
import { waitForRender } from './drive.js';

/**
 * A frame that breaks its own render pass, on the two attachment shapes the
 * rest of the suite never runs.
 *
 * A coverage mask or a blend evaluated against a copy of the frame ends the
 * frame's pass, fills a target of its own and resumes with a load, which puts
 * the MSAA resolve and the backdrop copy in places nothing else exercises.
 * Every other spec renders multisampled and offscreen, so single sampled and
 * the real swapchain are both untested without this: the copy reads whatever
 * the frame resolved into, and for a presented canvas that is the swapchain
 * texture rather than one this renderer owns.
 */
const SCENES = ['blend-readback', 'blend-transparent', 'trail-overlap'];

const SHAPES = [
  { query: '&sampleCount=1', what: 'single sampled' },
  { query: '&offscreen=0', what: 'presented to the canvas' },
];

interface Harness {
  __renderError?: string;
  renderer: {
    device?: () => GPUDevice;
    drewOffFrame?: () => boolean;
    _lastRender?: { scene: unknown };
    _ctx: { _sampleCount: number };
    wgOptions: { offscreen: boolean };
    renderAsync: (scene: unknown) => Promise<unknown>;
    captureFrame: () => Promise<{ data: Uint8Array }>;
  };
}

for (const { query, what } of SHAPES) {
  test(`a frame that splits its pass survives ${what}`, async ({ page }) => {
    test.skip(
      !!process.env.CI && query.includes('offscreen=0'),
      'the CI runner has no compositor, and acquiring the swapchain costs it the device',
    );
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
    });

    for (const scene of SCENES) {
      await page.goto(`/test/render/scene-harness.html?scene=${scene}&renderer=webgpu${query}`);
      await waitForRender(page);
      const state = await page.evaluate(async () => {
        const w = window as unknown as Harness;
        const r = w.renderer;
        const seen: string[] = [];
        const device = r.device?.();
        if (device) {
          device.onuncapturederror = event => seen.push((event as GPUUncapturedErrorEvent).error.message);
        }
        // drawn again, since a target reused across passes only goes wrong on
        // the frame after the one that made it
        await r.renderAsync(r._lastRender?.scene);
        const shot = await r.captureFrame();
        let ink = 0;
        for (let i = 3; i < shot.data.length; i += 4) {
          if (shot.data[i] > 8) {
            ink++;
          }
        }
        return {
          error: w.__renderError,
          gpu: seen,
          ink,
          offFrame: r.drewOffFrame?.() ?? null,
          samples: r._ctx._sampleCount,
          offscreen: r.wgOptions.offscreen,
        };
      });
      expect(state.error, `${scene} ${what}`).toBeUndefined();
      expect(state.gpu, `${scene} ${what} reported a GPU error`).toEqual([]);
      expect(state.ink, `${scene} ${what} drew nothing`).toBeGreaterThan(1000);
      expect(state.offFrame, `${scene} ${what} never split its pass`).toBe(true);
      if (query.includes('sampleCount=1')) {
        expect(state.samples, 'the sample count reached the renderer').toBe(1);
      }
      if (query.includes('offscreen=0')) {
        expect(state.offscreen, 'the offscreen option reached the renderer').toBe(false);
      }
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
