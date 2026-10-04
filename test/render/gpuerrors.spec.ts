import { expect, test } from '@playwright/test';
import { renderScenes } from './scenes.js';
import { collectPageErrors, harnessUrl, waitForRender } from './drive.js';

/**
 * WebGPU reports a misuse through `onuncapturederror` and carries on drawing,
 * so nothing in the suite saw one until this: a cached symbol buffer was being
 * made in the frame pool, which destroys it two frames later, and every frame
 * after the third submitted a destroyed buffer. The pixels looked fine.
 *
 * Each fixture is drawn several times rather than once, since a resource that
 * outlives its frame is exactly what a single draw cannot catch.
 */
const WATCHED = [
  'symbol-shapes',
  'symbol-custom',
  'arc-shapes',
  'gradient-strokes',
  'trail-stroked',
  'text-layout',
  'group-overlap',
].filter(name => renderScenes.includes(name));

test('redrawing a fixture reports no GPU error', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectPageErrors(page, { withConsole: true });

  for (const scene of WATCHED) {
    await page.goto(harnessUrl('scene', scene, 'webgpu', '&offscreen=1'));
    await waitForRender(page);
    await page.evaluate(
      async ([name]: string[]) => {
        const r = (
          window as unknown as {
            renderer: {
              device?: () => GPUDevice;
              _lastRender?: { scene: unknown };
              renderAsync: (s: unknown) => Promise<unknown>;
            };
          }
        ).renderer;
        const device = r.device?.();
        if (device) {
          device.onuncapturederror = event => {
            console.error(`GPU error in ${name}: ${(event as GPUUncapturedErrorEvent).error.message}`);
          };
        }
        const scene = r._lastRender?.scene;
        for (let i = 0; i < 6; i++) {
          await r.renderAsync(scene);
          await new Promise(res => setTimeout(res, 30));
        }
      },
      [scene],
    );
    await page.waitForTimeout(200);
  }

  expect(errors, errors.join('\n')).toEqual([]);
});
