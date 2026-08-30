import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { CROSS_CHECK_DEFAULT, crossCheckOverrides, renderSpecs } from './specs.js';

// Per-pixel color tolerance when deciding whether two pixels differ. The
// budget below is on the *fraction of differing pixels*, so this only needs
// to absorb 1-bit rounding between the two rasterizers.
const PIXELMATCH_THRESHOLD = 0.15;

// Optional on-disk gallery: with RENDER_ARTIFACTS=1 every spec's webgpu /
// canvas / diff PNG is written to test/render/output/ (gitignored) for manual
// side-by-side comparison, in addition to the always-on HTML report
// attachments. Off by default so a normal run does not litter hundreds of PNGs.
const WRITE_ARTIFACTS = !!process.env.RENDER_ARTIFACTS;
const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'output');
let outputDirReady = false;

function saveArtifact(specName: string, suffix: string, data: Buffer): void {
  if (!WRITE_ARTIFACTS) {
    return;
  }
  if (!outputDirReady) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    outputDirReady = true;
  }
  writeFileSync(join(OUTPUT_DIR, `${specName}-${suffix}.png`), data);
}

interface RenderResult {
  png: Buffer;
  rendererKind: string;
}

/** Renders a spec with the given renderer and returns the canvas pixels. */
async function renderSpec(page: Page, specName: string, renderer: 'webgpu' | 'canvas'): Promise<RenderResult> {
  const errors: string[] = [];
  const onPageError = (err: Error) => errors.push(String(err));
  const onConsole = (msg: { type: () => string; text: () => string; location: () => { url?: string } }) => {
    const url = msg.location()?.url ?? '';
    if (msg.type() === 'error' && !url.includes('favicon')) {
      errors.push(`${msg.text()} (${url})`);
    }
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  try {
    await page.goto(`/test/render/harness.html?spec=${encodeURIComponent(specName)}&renderer=${renderer}`);
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
        return w.__renderDone || w.__renderError;
      },
      undefined,
      { timeout: 45_000 },
    );

    const state = await page.evaluate(() => {
      const w = window as unknown as { __renderError?: string; __rendererKind?: string; __traces?: string[] };
      return { error: w.__renderError, rendererKind: w.__rendererKind ?? 'unknown', traces: w.__traces ?? [] };
    });
    const traces = state.traces.length ? `\ntraces:\n${state.traces.join('\n')}` : '';
    expect(state.error, `[${renderer}] harness error:\n${state.error}${traces}`).toBeUndefined();
    expect(errors, `[${renderer}] console errors:\n${errors.join('\n')}${traces}`).toEqual([]);

    return { png: await page.locator('#vis').screenshot(), rendererKind: state.rendererKind };
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}

function diffPngs(a: Buffer, b: Buffer, specName: string): { diffRatio: number; diff: Buffer } {
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    throw new Error(`Size mismatch for '${specName}': ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}.`);
  }
  const diff = new PNG({ width: imgA.width, height: imgA.height });
  const diffCount = pixelmatch(imgA.data, imgB.data, diff.data, imgA.width, imgA.height, {
    threshold: PIXELMATCH_THRESHOLD,
  });
  return { diffRatio: diffCount / (imgA.width * imgA.height), diff: PNG.sync.write(diff) };
}

const png = (data: Buffer) => ({ body: data, contentType: 'image/png' as const });

/**
 * The renderer is validated purely by rendering each spec with both the
 * WebGPU and canvas renderers and comparing them directly, with no stored image
 * baselines. The canvas renderer is the ground truth the WebGPU output must
 * match. The budget is low by default, with documented per-spec exceptions
 * for known, not-yet-implemented differences.
 *
 * Every render and diff is attached to the test, so the Playwright HTML
 * report (`npm run test:report`, or the CI "render-report" artifact) is a
 * browsable webgpu-vs-canvas comparison gallery, passing tests included.
 */
test.describe('WebGPU vs canvas', () => {
  for (const specName of renderSpecs) {
    test(specName, async ({ page }, testInfo: TestInfo) => {
      const webgpu = await renderSpec(page, specName, 'webgpu');
      await testInfo.attach(`${specName}-webgpu`, png(webgpu.png));
      saveArtifact(specName, 'webgpu', webgpu.png);
      // Guard against a silent fallback: each renderer must actually be the
      // one that ran, otherwise the comparison is meaningless.
      expect(webgpu.rendererKind, `expected WebGPU to render, got '${webgpu.rendererKind}'`).toBe('webgpu');

      const canvas = await renderSpec(page, specName, 'canvas');
      await testInfo.attach(`${specName}-canvas`, png(canvas.png));
      saveArtifact(specName, 'canvas', canvas.png);
      expect(canvas.rendererKind, `expected canvas to render, got '${canvas.rendererKind}'`).toBe('canvas');

      const budget = Object.hasOwn(crossCheckOverrides, specName) ? crossCheckOverrides[specName] : CROSS_CHECK_DEFAULT;
      if (budget === null) {
        return; // comparison intentionally skipped for this spec
      }

      const { diffRatio, diff } = diffPngs(webgpu.png, canvas.png, specName);
      await testInfo.attach(`${specName}-diff (${(diffRatio * 100).toFixed(2)}%)`, png(diff));
      saveArtifact(specName, 'diff', diff);
      if (process.env.CROSS_REPORT) {
        console.log(`DIFF ${specName} ${(diffRatio * 100).toFixed(3)}%`);
      }
      expect(
        diffRatio,
        `webgpu vs canvas diff ${(diffRatio * 100).toFixed(3)}% exceeds ${(budget * 100).toFixed(1)}%. ` +
          `Open the HTML report (npm run test:report) to compare`,
      ).toBeLessThanOrEqual(budget);
    });
  }
});
