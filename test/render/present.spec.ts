import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';
import { channelStats, renderInHarness } from './compare.js';
import { waitForRender } from './drive.js';

/**
 * The one path the rest of the suite never takes.
 *
 * Everything else renders offscreen, so local and CI agree and a runner with no
 * compositor never has to acquire a swapchain, which costs it its device. That
 * leaves `getCurrentTexture()` and the present itself exercised by nothing: the
 * renderer could compute every frame correctly and show none of them, and the
 * suite would stay green.
 *
 * So this renders into a real canvas and reads what the browser shows, by
 * screenshotting the element rather than the backing store. A WebGPU canvas
 * cannot be read back after a present, and that is the point: a screenshot is
 * the compositor's own answer to whether the frame arrived.
 */
const SPEC = 'bar';

/** Share of pixels carrying something other than the white the page is on. */
function inked(buffer: Buffer): number {
  const img = PNG.sync.read(buffer);
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      if (img.data[i + c] * a + 255 * (1 - a) < 250) {
        n++;
        break;
      }
    }
  }
  return n / (img.width * img.height);
}

function size(buffer: Buffer): string {
  const img = PNG.sync.read(buffer);
  return `${img.width}x${img.height}`;
}

interface Presented {
  /** Null when the swapchain could not be acquired at all, with `why` saying so. */
  shot: Buffer | null;
  why: string;
}

/** What the browser shows, which is not the same as what the renderer drew. */
async function present(page: Page, spec: string): Promise<Presented> {
  await page.goto(`/test/render/harness.html?spec=${spec}&renderer=webgpu&offscreen=0`);
  // swallowed, since this checks what the canvas shows even when nothing settled
  await waitForRender(page).catch(() => undefined);

  const state = await page.evaluate(() => {
    const w = window as unknown as {
      view?: { _renderer?: Record<string, unknown> };
      renderer?: Record<string, unknown>;
      __renderError?: string;
    };
    // the spec harness hands out its View, the scene harness its renderer
    const r = w.view?._renderer ?? w.renderer;
    return {
      error: w.__renderError ?? null,
      lost: (r?.deviceLostReason as string | null) ?? null,
      offscreen: Boolean((r?.wgOptions as Record<string, unknown> | undefined)?.offscreen),
      hasRenderer: Boolean(r),
    };
  });

  // Acquiring a swapchain is the thing a runner with no compositor cannot do,
  // and it answers by taking the device rather than by failing the call. That
  // is a property of where this runs, not of the renderer, so it is reported
  // and skipped rather than failed. Anything else here is a real failure.
  if (state.lost) {
    return { shot: null, why: `acquiring the swapchain cost the device: ${state.lost}` };
  }
  expect(state.hasRenderer, `the harness never got a renderer: ${state.error}`).toBe(true);
  expect(state.error, `rendering onto a real canvas threw: ${state.error}`).toBeNull();
  expect(state.offscreen, 'offscreen=0 reached the renderer, so this is the swapchain path').toBe(false);
  return { shot: await page.locator('#vis canvas').screenshot(), why: '' };
}

test('a real canvas shows the frame', async ({ page }) => {
  test.setTimeout(180_000);
  const { shot, why } = await present(page, SPEC);
  test.skip(shot === null, why);
  const shown = shot as Buffer;
  const drawn = await renderInHarness(page, `/test/render/harness.html?spec=${SPEC}&renderer=webgpu`, 'webgpu');

  expect(
    inked(shown),
    'the canvas on screen is blank, so the renderer drew a frame and presented none of it',
  ).toBeGreaterThan(0.05);

  expect(size(shown), 'the screenshot is the canvas at its own size, or the comparison below means nothing').toBe(
    size(drawn.png),
  );

  const { max, mean } = channelStats(shown, drawn.png);
  expect(
    max,
    `the frame on screen is ${max} channel levels from the one the renderer drew, mean ${mean.toFixed(2)}. ` +
      `The offscreen path the rest of the suite checks is not what a user sees`,
  ).toBeLessThanOrEqual(2);
});
