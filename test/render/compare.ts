import { expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { shotToPng, type Shot } from './snapshot.js';
import { waitForRender } from './drive.js';
import { manifestPath, outputDir } from '../../scripts/paths.mjs';
import { FLAT_MIN_SAMPLE, INK_MIN_RATIO } from './specs.js';
import type { SkippedScene } from './scenes.js';
import '../measures.js';
import type { ChannelStats } from '../measures.js';

export type { ChannelStats };

// Per-pixel color tolerance when deciding whether two pixels differ. The
// budgets are on the *fraction of differing pixels*, so this only needs to
// absorb 1-bit rounding between the two rasterizers.
const PIXELMATCH_THRESHOLD = 0.15;

// Optional on-disk gallery: with RENDER_ARTIFACTS=1 every case's webgpu /
// canvas / diff PNG is written to test/render/output/ (gitignored) along with
// an index.json of the measurements, which test/render/gallery.html reads to
// browse them side by side, wiped, blinked or as the diff, ranked by any of the
// numbers. Off by default so a normal run does not litter hundreds of PNGs.
const WRITE_ARTIFACTS = !!process.env.RENDER_ARTIFACTS;
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
  ensureOutputDir();
  writeFileSync(join(outputDir, `${name}-${suffix}.png`), data);
}

function ensureOutputDir(): void {
  if (!outputDirReady) {
    mkdirSync(outputDir, { recursive: true });
    outputDirReady = true;
  }
}

/** One row of test/render/output/index.json, which gallery.html reads. */
export interface GalleryCase {
  /** What the case is called, e.g. `bar` or `arc-shapes`. */
  name: string;
  /** `spec` or `fixture`. */
  kind: string;
  /** Prefix of its three pngs, which is the name for a spec and `scene-<name>` for a fixture. */
  file: string;
  /**
   * The fixture or spec it was drawn from, where that is not the name. A
   * variant renders an existing spec with an option set, so `label-drift` is
   * drawn from `label` and there is no file of its own to look for.
   */
  source?: string;
  width: number;
  height: number;
  diff: number;
  /**
   * Fraction of pixels at least one channel differs on at all, which the one
   * above cannot say: it counts only what passes a colour threshold, so a case
   * reads 0.000% while tens of thousands of pixels are a level or two apart.
   */
  touched: number;
  tile: number;
  mean: number;
  /** Mean signed channel difference, which says whether the error has a direction. */
  bias: number;
  flat: number;
  flatSample: number;
  quad: number;
  /** The budgets this case was held to, so the gallery can say what passing meant. */
  budgets: { diff: number | null; tile: number; mean: number; bias: number; flat: number; quad?: number };
  /** What the case is for, from a fixture's own description. */
  note?: string;
  /**
   * Set where the case is recorded but not gated. A skip is still rendered and
   * still shown, so the difference it names is on screen in the gallery beside
   * the cases that pass, with the release it is queued for.
   */
  skip?: SkippedScene;
}

/**
 * What the run was configured with. A number in the gallery only means
 * something next to the settings that produced it, and its live mode compares
 * at whatever the browser is set to rather than at these.
 */
function runSettings() {
  return {
    dpr: Number(process.env.RENDER_DPR ?? 1),
    ci: !!process.env.CI,
    pixelmatchThreshold: PIXELMATCH_THRESHOLD,
    includeAA: true,
    flatEps: RenderMeasures.FLAT_EPS,
    rendererOptions: 'renderer defaults, drawing offscreen',
  };
}

/** Which commit, version and CI run the pngs came from, for the gallery to say. */
function runIdentity() {
  const env = process.env;
  let sha = env.GITHUB_SHA ?? null;
  if (!sha) {
    try {
      sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      sha = null;
    }
  }
  const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  const repo = env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}` : null;
  return {
    sha,
    version: (JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version,
    repo,
    url: repo && env.GITHUB_RUN_ID ? `${repo}/actions/runs/${env.GITHUB_RUN_ID}` : null,
  };
}

let identity: ReturnType<typeof runIdentity> | null = null;

const SCENES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'scenes');
const SPECS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'specs-valid');

/**
 * Whether the case still exists to be drawn. A renamed or deleted one keeps
 * its row otherwise: the pngs it was recorded with are still on disk, so the
 * row stays and the gallery shows numbers from whatever the renderer did back
 * then. `tmp-joinblend` sat there reading 100% of pixels differing long after
 * the fixture was gone.
 */
function stillExists(c: GalleryCase): boolean {
  const source = c.source ?? c.name;
  return c.kind === 'fixture'
    ? existsSync(join(SCENES_DIR, `${source}.json`)) || existsSync(`${SCENES_DIR}-hostile/${source}.json`)
    : existsSync(join(SPECS_DIR, `${source}.vg.json`));
}
let gallery: Map<string, GalleryCase> | null = null;

/**
 * Adds a case to the gallery manifest, so `test/render/gallery.html` can list
 * and rank what is on disk. Rewritten on every case rather than at the end,
 * since a run that stops early should still leave a usable index. Merges what
 * is already there, so a filtered run adds to the last full one.
 */
export function recordCase(entry: GalleryCase): void {
  if (!WRITE_ARTIFACTS) {
    return;
  }
  ensureOutputDir();
  if (!gallery) {
    gallery = new Map();
    if (existsSync(manifestPath)) {
      try {
        for (const c of JSON.parse(readFileSync(manifestPath, 'utf8')).cases as GalleryCase[]) {
          gallery.set(c.file, c);
        }
      } catch {
        // a truncated manifest from an interrupted run is not worth failing over
      }
    }
  }
  // Keyed by file, not name: symbol-shapes is both a spec and a fixture.
  gallery.set(entry.file, entry);
  // A run that only covered some cases still keeps the rest, so the rows are
  // dropped on what is on disk rather than on what this run touched.
  const cases = [...gallery.values()]
    .filter(c => existsSync(join(outputDir, `${c.file}-canvas.png`)) && stillExists(c))
    .sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ generated: new Date().toISOString(), run: (identity ??= runIdentity()), settings: runSettings(), cases }, null, 2)}
`,
  );
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
    await waitForRender(page, 45_000);

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
    // The capture records its own failures, and it runs after the traces above
    // were read. Without this a captureFrame that fell back to a blank
    // toDataURL is reported as a pixel diff with no cause.
    const during = (await page.evaluate(() => (window as unknown as { __traces?: string[] }).__traces ?? [])).slice(
      state.traces.length,
    );
    const late = during.join('\n');
    expect(shot, `[${renderer}] could not snapshot the canvas\n${late}`).toBeTruthy();
    expect(during, `[${renderer}] the capture failed:\n${late}`).toEqual([]);
    expect(errors, `[${renderer}] console errors during capture:\n${errors.join('\n')}`).toEqual([]);
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

/** A render as the measures see it, with its alpha composited over white. */
export function overWhite(buf: Buffer): Buffer {
  return PNG.sync.write(flatten(PNG.sync.read(buf)));
}

/** Side of the square the worst-region measure is taken over, in pixels. */
export const TILE = 32;

export interface DiffResult {
  /** Fraction of pixels pixelmatch counts as different, past its threshold. */
  diffRatio: number;
  /** Fraction of pixels at least one channel differs on at all. */
  touched: number;
  /** Densest TILE by TILE square of difference, as a fraction of that square. */
  worstTile: number;
  worstTileAt: [number, number];
  diff: Buffer;
  width: number;
  height: number;
  /** Largest channel difference between block averages. See BLOCK_SCENE_PX in test/measures.js. */
  quadDelta: number;
  /** Mean channel difference over pixels either side inked. */
  meanDelta: number;
  /** Largest mean signed channel difference over inked pixels. */
  biasDelta: number;
  /** Fraction of the frame either side drew on, which every measure needs. */
  ink: number;
  /** The same, over inked pixels away from any edge. Zero when nothing qualified. */
  flatMeanDelta: number;
  /** How many pixels that average is over. */
  flatSample: number;
}

export function diffPngs(a: Buffer, b: Buffer, name: string): DiffResult {
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
  const { ratio, at } = worstRegion(diff, imgA.width, imgA.height);
  const { quad, mean, bias, touched, ink, flatMean, flatSample } = deltas(imgA, imgB);
  return {
    diffRatio: diffCount / (imgA.width * imgA.height),
    touched,
    width: imgA.width,
    height: imgA.height,
    worstTile: ratio,
    worstTileAt: at,
    diff: PNG.sync.write(diff),
    quadDelta: quad,
    meanDelta: mean,
    biasDelta: bias,
    ink,
    flatMeanDelta: flatMean,
    flatSample,
  };
}

/**
 * Densest TILE by TILE square of the difference, as a fraction of that square.
 *
 * A whole-image percentage is diluted by however much empty space a spec
 * happens to have, so a small region that is badly wrong reads the same as a
 * faint haze over everything. This says how concentrated the difference is, and
 * where to look.
 */
function worstRegion(diff: PNG, width: number, height: number): { ratio: number; at: [number, number] } {
  let ratio = 0;
  let at: [number, number] = [0, 0];
  for (let ty = 0; ty < height; ty += TILE) {
    for (let tx = 0; tx < width; tx += TILE) {
      const w = Math.min(TILE, width - tx);
      const h = Math.min(TILE, height - ty);
      let n = 0;
      for (let y = ty; y < ty + h; y++) {
        for (let x = tx; x < tx + w; x++) {
          // pixelmatch paints a difference red, leaving matched pixels grey
          const i = (y * width + x) * 4;
          if (diff.data[i] > 200 && diff.data[i + 1] < 100) {
            n++;
          }
        }
      }
      const r = n / (w * h);
      if (r > ratio) {
        ratio = r;
        at = [tx, ty];
      }
    }
  }
  return { ratio, at };
}

/**
 * Largest single channel difference between two renders. The differing-pixel
 * count says how much moved, this says how far off the worst pixel is, which is
 * what catches a coverage change too small to trip the pixel threshold.
 */
export function maxChannelDelta(a: Buffer, b: Buffer): number {
  const imgA = flatten(PNG.sync.read(a));
  const imgB = flatten(PNG.sync.read(b));
  let worst = 0;
  for (let i = 0; i < imgA.data.length; i++) {
    const delta = Math.abs(imgA.data[i] - imgB.data[i]);
    if (delta > worst) {
      worst = delta;
    }
  }
  return worst;
}

/** The device pixel ratio the suite is rendering at. */
export const renderRatio = (): number => Math.max(1, Math.round(Number(process.env.RENDER_DPR ?? 1)));

/** Per-channel error with the local measure sized for the ratio the suite renders at. */
function deltas(imgA: PNG, imgB: PNG): ChannelStats {
  return RenderMeasures.deltas(imgA, imgB, RenderMeasures.BLOCK_SCENE_PX * renderRatio());
}

/** Per-channel error, which says how far off a render is rather than how much moved. */
export function channelStats(a: Buffer, b: Buffer): ChannelStats {
  return deltas(flatten(PNG.sync.read(a)), flatten(PNG.sync.read(b)));
}

export const png = (data: Buffer) => ({ body: data, contentType: 'image/png' as const });

/** What a comparison is allowed to be off by, already resolved per case. */
export interface CaseBudgets {
  /** Fraction of pixels that may differ, or null where the count is skipped. */
  diff: number | null;
  tile: number;
  mean: number;
  bias: number;
  flat: number;
  /** Fixtures gate the worst block too. A spec carries too much text for it. */
  quad?: number;
}

/**
 * One webgpu against canvas comparison: render both, record it for the
 * gallery, attach everything to the report, and hold it to its budgets.
 *
 * The specs and the fixtures differ in how they build a url and where their
 * budgets come from, and in nothing else. Both had written this out, which
 * left the gate itself in two places to keep in step.
 */
export async function compareCase(
  testInfo: TestInfo,
  opts: {
    name: string;
    kind: GalleryCase['kind'];
    /** Prefix for the artifact files, which the gallery reads back. */
    file: string;
    /** The fixture or spec behind it, where a variant renders another one. */
    source?: string;
    label?: string;
    note?: string;
    /** Recorded and shown but not gated, with the release it is queued for. */
    skip?: SkippedScene;
    budgets: CaseBudgets;
    render: (renderer: RendererName) => Promise<RenderResult>;
  },
): Promise<void> {
  const { name, file, budgets } = opts;
  const webgpu = await opts.render('webgpu');
  await testInfo.attach(`${name}-webgpu`, png(webgpu.png));
  saveArtifact(file, 'webgpu', webgpu.png);
  // Guard against a silent fallback: each renderer must actually be the one
  // that ran, otherwise the comparison is meaningless.
  expect(webgpu.rendererKind, `expected WebGPU to render, got '${webgpu.rendererKind}'`).toBe('webgpu');

  const canvas = await opts.render('canvas');
  await testInfo.attach(`${name}-canvas`, png(canvas.png));
  saveArtifact(file, 'canvas', canvas.png);
  expect(canvas.rendererKind, `expected canvas to render, got '${canvas.rendererKind}'`).toBe('canvas');

  const m = diffPngs(webgpu.png, canvas.png, name);
  recordCase({
    name,
    kind: opts.kind,
    file,
    source: opts.source,
    width: m.width,
    height: m.height,
    diff: m.diffRatio,
    touched: m.touched,
    tile: m.worstTile,
    mean: m.meanDelta,
    bias: m.biasDelta,
    flat: m.flatMeanDelta,
    flatSample: m.flatSample,
    quad: m.quadDelta,
    note: opts.note,
    skip: opts.skip,
    budgets,
  });
  await testInfo.attach(`${name}-diff (${(m.diffRatio * 100).toFixed(2)}%)`, png(m.diff));
  saveArtifact(file, 'diff', m.diff);
  if (process.env.CROSS_REPORT) {
    console.log(
      `DIFF ${opts.label ?? name} ${(m.diffRatio * 100).toFixed(3)}% TILE ${(m.worstTile * 100).toFixed(1)}% ` +
        `at ${m.worstTileAt.join(',')} MEAN ${m.meanDelta.toFixed(2)} BIAS ${m.biasDelta.toFixed(2)} ` +
        `QUAD ${m.quadDelta.toFixed(1)} FLAT ${m.flatMeanDelta.toFixed(2)} over ${m.flatSample}px ` +
        `INK ${(m.ink * 100).toFixed(2)}%`,
    );
  }

  // A skipped case is recorded and shown and nothing below applies to it. The
  // difference it names is the reason it is skipped, so gating it would only
  // restate that in a failure.
  if (opts.skip) {
    return;
  }

  // Every measure below compares the two renders, so two blank ones agree on
  // everything. A case that draws nothing passes all six having tested
  // nothing, which is what this is here to stop.
  expect(
    m.ink,
    `the two renders between them drew on ${(m.ink * 100).toFixed(2)}% of the frame, under the ` +
      `${(INK_MIN_RATIO * 100).toFixed(1)}% a case needs before a comparison means anything. ` +
      `Two blank renders match perfectly, so this is a case that tested nothing`,
  ).toBeGreaterThan(INK_MIN_RATIO);

  // The worst pixel, where the case is small enough for it to mean something.
  if (budgets.quad !== undefined) {
    expect(
      m.quadDelta,
      `the worst ${RenderMeasures.BLOCK_SCENE_PX} scene pixel block averages ${m.quadDelta.toFixed(1)} channel levels off ` +
        `canvas, over the ${budgets.quad} allowed. The pixel count ` +
        `below can miss this, since a coverage change stays under its colour threshold`,
    ).toBeLessThanOrEqual(budgets.quad);
  }

  // Checked even where the pixel count is skipped, since the two measure
  // different things: this is the colour error the count cannot see.
  expect(
    m.meanDelta,
    `the average inked pixel is ${m.meanDelta.toFixed(2)} channel levels off canvas, over the ` +
      `${budgets.mean} allowed. The pixel count below ignores anything under 39 levels, so a ` +
      `uniform shift or a colour cast reads as a perfect match there`,
  ).toBeLessThanOrEqual(budgets.mean);

  // A coverage difference pushes pixels both ways and a systematic one does
  // not, so the signed mean catches what the unsigned mean above cannot on
  // anything made of edges.
  expect(
    m.biasDelta,
    `the average inked pixel is ${m.biasDelta.toFixed(2)} channel levels off canvas in the same ` +
      `direction, over the ${budgets.bias} allowed. A one-sided error is the render being wrong ` +
      `rather than the two rasterizers disagreeing about an edge`,
  ).toBeLessThanOrEqual(budgets.bias);

  // Away from the edges the two rasterizers should agree closely, so where
  // there is enough interior to measure, the budget is much tighter.
  if (m.flatSample >= FLAT_MIN_SAMPLE) {
    expect(
      m.flatMeanDelta,
      `away from any edge the average inked pixel is ${m.flatMeanDelta.toFixed(2)} channel levels off ` +
        `canvas over ${m.flatSample} pixels, past the ${budgets.flat} allowed. A mark interior carries no ` +
        `antialiasing difference, so this is the colour itself rather than coverage`,
    ).toBeLessThanOrEqual(budgets.flat);
  }

  if (budgets.diff === null) {
    return; // pixel comparison intentionally skipped for this case
  }
  expect(
    m.worstTile,
    `a 32px square at ${m.worstTileAt.join(',')} is ${(m.worstTile * 100).toFixed(1)}% different, ` +
      `over the ${(budgets.tile * 100).toFixed(0)}% allowed. The whole-image number below ` +
      `is diluted by everything that matches`,
  ).toBeLessThanOrEqual(budgets.tile);
  expect(
    m.diffRatio,
    `webgpu vs canvas diff ${(m.diffRatio * 100).toFixed(3)}% exceeds ${((budgets.diff as number) * 100).toFixed(1)}%. ` +
      `Open the HTML report (npm run test:report) to compare`,
  ).toBeLessThanOrEqual(budgets.diff);
}
