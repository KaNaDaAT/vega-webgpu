import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { png, renderInHarness, saveArtifact } from './compare.js';

/**
 * Renders scenegraph fixtures built from input a mark should never see: NaN and
 * Infinity coordinates, zero and negative extents, values far outside the
 * viewport, absent styling, and shapes with too few points.
 *
 * Nothing here is compared against canvas, because canvas has its own opinions
 * about nonsense. What is asserted is that the renderer survives it: no thrown
 * error, no lost device, and no geometry smeared across the frame, which is how
 * one NaN vertex shows up.
 */
const HOSTILE = join(dirname(fileURLToPath(import.meta.url)), 'scenes-hostile');

/**
 * Share of the frame a case may paint. A single NaN vertex stretches its
 * triangle across everything, so a ceiling here is what separates "survived" from
 * "survived and drew something sane".
 */
const MAX_COVERAGE: Record<string, number> = {
  'nan-coords': 0.05,
  'degenerate-sizes': 0.05,
  'empty-and-missing': 0.01,
  'single-point-shapes': 0.01,
  // one rect is deliberately two billion pixels wide, so covering the frame is right
  'huge-values': 1,
};

/** Share of pixels that are not the background. */
function coverage(buffer: Buffer): number {
  const img = PNG.sync.read(buffer);
  let painted = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] < 247 || img.data[i + 1] < 247 || img.data[i + 2] < 247) {
      painted++;
    }
  }
  return painted / (img.width * img.height);
}
const cases = readdirSync(HOSTILE)
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace(/\.json$/, ''))
  .sort();

async function renderHostile(page: Page, name: string) {
  const url = `/test/render/scene-harness.html?dir=hostile&scene=${encodeURIComponent(name)}&renderer=webgpu`;
  const result = await renderInHarness(page, url, 'webgpu');
  const state = await page.evaluate(() => {
    const w = window as unknown as { renderer?: Record<string, unknown> };
    const r = w.renderer;
    const device = typeof r?.device === 'function' ? (r.device as () => unknown)() : null;
    return { lost: (r?.deviceLostReason as string | null) ?? null, hasDevice: !!device };
  });
  return { ...result, ...state };
}

test.describe('hostile input', () => {
  for (const name of cases) {
    test(name, async ({ page }, testInfo: TestInfo) => {
      const out = await renderHostile(page, name);
      await testInfo.attach(`${name}-webgpu`, png(out.png));
      saveArtifact(name, 'webgpu', out.png);

      expect(out.rendererKind, `expected WebGPU to render, got '${out.rendererKind}'`).toBe('webgpu');
      expect(out.lost, `the device was lost: ${out.lost}`).toBeNull();
      expect(out.hasDevice, 'the renderer dropped its device').toBe(true);

      const painted = coverage(out.png);
      const budget = MAX_COVERAGE[name] ?? 0.05;
      expect(
        painted,
        `painted ${(painted * 100).toFixed(1)}% of the frame, over the ${(budget * 100).toFixed(0)}% allowed. ` +
          `A vertex that came out NaN or unbounded stretches its triangle across everything`,
      ).toBeLessThanOrEqual(budget);
    });
  }
});
