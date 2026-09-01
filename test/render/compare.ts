import { expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { shotToPng, type Shot } from './snapshot.js';

// Per-pixel color tolerance when deciding whether two pixels differ. The
// budgets are on the *fraction of differing pixels*, so this only needs to
// absorb 1-bit rounding between the two rasterizers.
const PIXELMATCH_THRESHOLD = 0.15;

// Optional on-disk gallery: with RENDER_ARTIFACTS=1 every case's webgpu /
// canvas / diff PNG is written to test/render/output/ (gitignored) for manual
// side-by-side comparison, in addition to the always-on HTML report
// attachments. Off by default so a normal run does not litter hundreds of PNGs.
const WRITE_ARTIFACTS = !!process.env.RENDER_ARTIFACTS;
const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'output');
let outputDirReady = false;

export type RendererName = 'webgpu' | 'canvas';

export interface RenderResult {
  png: Buffer;
  rendererKind: string;
}

export function saveArtifact(name: string, suffix: string, data: Buffer): void {
  if (!WRITE_ARTIFACTS) {
    return;
  }
  if (!outputDirReady) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    outputDirReady = true;
  }
  writeFileSync(join(OUTPUT_DIR, `${name}-${suffix}.png`), data);
}

/** Loads a harness url, waits for it to settle and returns the canvas pixels. */
export async function renderInHarness(page: Page, url: string, renderer: RendererName): Promise<RenderResult> {
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
    await page.goto(url);
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

    const shot: Shot | null = await page.evaluate(async () => {
      const w = window as unknown as { __snapshot?: () => Promise<unknown> };
      return ((await w.__snapshot?.()) ?? null) as Shot | null;
    });
    expect(shot, `[${renderer}] could not snapshot the canvas`).toBeTruthy();
    return { png: shotToPng(shot as Shot), rendererKind: state.rendererKind };
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}

/** Composites RGBA over white so a transparent backing store compares fairly. */
function flatten(img: PNG): PNG {
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] = Math.round(data[i] * a + 255 * (1 - a));
    data[i + 1] = Math.round(data[i + 1] * a + 255 * (1 - a));
    data[i + 2] = Math.round(data[i + 2] * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
  return img;
}

export function diffPngs(a: Buffer, b: Buffer, name: string): { diffRatio: number; diff: Buffer } {
  const imgA = flatten(PNG.sync.read(a));
  const imgB = flatten(PNG.sync.read(b));
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    throw new Error(`Size mismatch for '${name}': ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}.`);
  }
  const diff = new PNG({ width: imgA.width, height: imgA.height });
  const diffCount = pixelmatch(imgA.data, imgB.data, diff.data, imgA.width, imgA.height, {
    threshold: PIXELMATCH_THRESHOLD,
    // Count antialiased pixels too. Pixelmatch's heuristic calls an isolated
    // high-contrast pixel antialiasing, which is exactly what a one pixel
    // marker shift looks like, so leaving them out hid half the differences in
    // the suite and reported specs as 0.000% with visible marks out of place.
    includeAA: true,
  });
  return { diffRatio: diffCount / (imgA.width * imgA.height), diff: PNG.sync.write(diff) };
}

export const png = (data: Buffer) => ({ body: data, contentType: 'image/png' as const });
