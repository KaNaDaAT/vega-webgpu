import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { diffPngs, overWhite, renderInHarness, renderRatio, type DiffResult } from './compare.js';
import {
  BIAS_DELTA_DEFAULT,
  CROSS_CHECK_DEFAULT,
  FLAT_MEAN_DEFAULT,
  FLAT_MIN_SAMPLE,
  MEAN_DELTA_DEFAULT,
  TILE_CHECK_DEFAULT,
} from './specs.js';
import {
  QUAD_DELTA_DEFAULT,
  SCENE_BIAS_DELTA_DEFAULT,
  SCENE_CHECK_DEFAULT,
  SCENE_FLAT_MEAN_DEFAULT,
  SCENE_MEAN_DELTA_DEFAULT,
} from './scenes.js';

/**
 * What each measure can see, on a render against itself with a known error
 * added, so the numbers are the error rather than an argument about one.
 *
 * README.md claims six measures each answer a question the others cannot. Each
 * case below injects one kind of error and shows the measure it belongs to
 * firing while the rest report a pass, against the same default budgets the
 * suite gates on. A measure with no case here is a measure nobody has shown
 * earns its place.
 *
 * The mutations run on the render composited over white, which is what the
 * measures compare. A blot paints where a spec has nothing but transparency,
 * and on the raw buffer that lands as black rather than as the delta asked for.
 */

/** The six numbers, named the way README.md names them. */
type Measure = 'diff' | 'tile' | 'quad' | 'mean' | 'bias' | 'flat';

function readings(m: DiffResult): Record<Measure, number> {
  return {
    diff: m.diffRatio,
    tile: m.worstTile,
    quad: m.quadDelta,
    mean: m.meanDelta,
    bias: m.biasDelta,
    flat: m.flatMeanDelta,
  };
}

/** A fixture and a spec are held to different numbers, so both are here. */
const SPEC_BUDGETS: Record<Measure, number> = {
  diff: CROSS_CHECK_DEFAULT,
  tile: TILE_CHECK_DEFAULT,
  quad: QUAD_DELTA_DEFAULT,
  mean: MEAN_DELTA_DEFAULT,
  bias: BIAS_DELTA_DEFAULT,
  flat: FLAT_MEAN_DEFAULT,
};

const SCENE_BUDGETS: Record<Measure, number> = {
  diff: SCENE_CHECK_DEFAULT,
  tile: TILE_CHECK_DEFAULT,
  quad: QUAD_DELTA_DEFAULT,
  mean: SCENE_MEAN_DELTA_DEFAULT,
  bias: SCENE_BIAS_DELTA_DEFAULT,
  flat: SCENE_FLAT_MEAN_DEFAULT,
};

function log(label: string, m: DiffResult): void {
  const r = readings(m);
  console.log(
    `GATE ${label}: diff ${(r.diff * 100).toFixed(3)}%, tile ${(r.tile * 100).toFixed(1)}%, ` +
      `quad ${r.quad.toFixed(1)}, mean ${r.mean.toFixed(2)}, bias ${r.bias.toFixed(2)}, ` +
      `flat ${r.flat.toFixed(2)} over ${m.flatSample}px`,
  );
}

/** Two of the six are a share of the frame and four are channel levels. */
function shown(name: Measure, value: number): string {
  return name === 'diff' || name === 'tile' ? `${(value * 100).toFixed(3)}%` : value.toFixed(2);
}

/** The measures that stay inside their budget, which is the half worth proving. */
function expectBlind(m: DiffResult, budgets: Record<Measure, number>, blind: Measure[]): void {
  const r = readings(m);
  for (const name of blind) {
    expect(
      r[name],
      `${name} was meant to be blind to this and reads ${shown(name, r[name])} ` +
        `against a budget of ${shown(name, budgets[name])}`,
    ).toBeLessThanOrEqual(budgets[name]);
  }
}

function renderSpec(page: Page, spec: string): Promise<Buffer> {
  return renderInHarness(page, `/test/render/harness.html?spec=${spec}&renderer=webgpu&offscreen=1`, 'webgpu').then(
    s => s.png,
  );
}

function renderScene(page: Page, scene: string): Promise<Buffer> {
  return renderInHarness(page, `/test/render/scene-harness.html?scene=${scene}&renderer=webgpu`, 'webgpu').then(
    s => s.png,
  );
}

/** The same render with every drawn pixel a few channel levels darker. */
function darken(buf: Buffer, levels: number): Buffer {
  const img = PNG.sync.read(buf);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) {
      continue;
    }
    for (let c = 0; c < 3; c++) {
      img.data[i + c] = Math.max(0, img.data[i + c] - levels);
    }
  }
  return PNG.sync.write(img);
}

/** One square region darkened, which is a mark drawn in the wrong colour. */
function blot(buf: Buffer, x0: number, y0: number, side: number, levels: number): Buffer {
  const img = PNG.sync.read(buf);
  for (let y = y0; y < Math.min(y0 + side, img.height); y++) {
    for (let x = x0; x < Math.min(x0 + side, img.width); x++) {
      const i = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        img.data[i + c] = Math.max(0, img.data[i + c] - levels);
      }
    }
  }
  return PNG.sync.write(img);
}

/**
 * Every inked pixel moved by the same amount, the direction alternating with
 * the pixel. A rounding or dither error looks like this: too large to be
 * antialiasing, too scattered to be one-sided, and under the colour threshold
 * the pixel count works to.
 */
function scatterInk(buf: Buffer, levels: number): Buffer {
  const img = PNG.sync.read(buf);
  const { width: w, height: h, data } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!(data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250)) {
        continue;
      }
      const sign = (x + y) % 2 === 0 ? 1 : -1;
      for (let c = 0; c < 3; c++) {
        data[i + c] = Math.max(0, Math.min(255, data[i + c] + sign * levels));
      }
    }
  }
  return PNG.sync.write(img);
}

/**
 * Only the pixels away from any edge, moved by a few levels, the direction
 * flipping every 16 pixels so the signed mean cancels. That is a mark interior
 * filled with the wrong colour, which is the one thing left after the edges
 * both rasterizers disagree about are dropped.
 */
function interiorShift(buf: Buffer, levels: number, block: number): Buffer {
  const src = PNG.sync.read(buf);
  const img = PNG.sync.read(buf);
  const { width: w, height: h } = src;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (!(src.data[i] < 250 || src.data[i + 1] < 250 || src.data[i + 2] < 250)) {
        continue;
      }
      let spread = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = ((y + dy) * w + x + dx) * 4;
          for (let c = 0; c < 3; c++) {
            spread = Math.max(spread, Math.abs(src.data[j + c] - src.data[i + c]));
          }
        }
      }
      if (spread > 2) {
        continue;
      }
      const sign = ((x / block) | 0) % 2 === ((y / block) | 0) % 2 ? 1 : -1;
      for (let c = 0; c < 3; c++) {
        img.data[i + c] = Math.max(0, Math.min(255, src.data[i + c] + sign * levels));
      }
    }
  }
  return PNG.sync.write(img);
}

/** A band of rows moved sideways, so every mark crossing it is out of place. */
function displaceRows(buf: Buffer, y0: number, y1: number, dx: number): Buffer {
  const src = PNG.sync.read(buf);
  const img = PNG.sync.read(buf);
  const { width: w, height: h } = src;
  // The pixel count is a share of the whole frame, so the band has to be the
  // same share of the scene at either ratio. Sized in device pixels it covers
  // a quarter of the scene at dpr 2 and reads a quarter of the error.
  const r = renderRatio();
  [y0, y1, dx] = [y0 * r, y1 * r, dx * r];
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const sx = x - dx;
      for (let c = 0; c < 3; c++) {
        img.data[i + c] = sx < 0 || sx >= w ? 255 : src.data[(y * w + sx) * 4 + c];
      }
    }
  }
  return PNG.sync.write(img);
}

/**
 * `stocks-index` is text and a thin line, which is the case the other measures
 * are weakest on: it has almost no interior, so the flat-region check cannot
 * fill its sample, and the differing-pixel count ignores anything under 39
 * levels. Four levels is well inside both of those and outside the signed mean.
 *
 * How little interior it has is a property of the pixel grid rather than of
 * the case. At dpr 1 there is none to sample, and at dpr 2 the same marks
 * cover four times the pixels, 4073 of them qualify and the flat mean reads
 * 4.00 and fires on its own. So the claim that holds at either ratio is that
 * the flat measure either cannot apply here or catches this too.
 */
test('the signed mean sees a systematic error the pixel count cannot', async ({ page }) => {
  test.setTimeout(180_000);
  const shot = await renderSpec(page, 'stocks-index');
  const off = diffPngs(darken(shot, 4), shot, 'stocks-index');
  log('4 levels darker', off);

  expect(off.diffRatio, 'the pixel count should be blind to this').toBeLessThan(0.0001);
  expect(off.biasDelta, 'the signed mean is the one that has to see it').toBeGreaterThan(BIAS_DELTA_DEFAULT);
  expectBlind(off, SPEC_BUDGETS, ['diff', 'tile', 'quad', 'mean']);
  expect(
    off.flatSample < FLAT_MIN_SAMPLE || off.flatMeanDelta > FLAT_MEAN_DEFAULT,
    `the flat mean sampled ${off.flatSample}px and read ${off.flatMeanDelta.toFixed(2)}, which is ` +
      `neither too small a sample to apply nor enough to fire against a budget of ${FLAT_MEAN_DEFAULT}`,
  ).toBe(true);
});

/** And the same render against itself has to read as no error at all. */
test('an identical render carries no bias', async ({ page }) => {
  test.setTimeout(180_000);
  const shot = await renderSpec(page, 'stocks-index');
  const same = diffPngs(shot, shot, 'stocks-index');
  expect(same.biasDelta).toBe(0);
  expect(same.meanDelta).toBe(0);
});

/**
 * The same case again, with an error that has no direction. Every inked pixel
 * moves 16 levels, half of them up and half down, which the signed mean cancels
 * out and the colour threshold never sees.
 */
test('the unsigned mean sees a scattered error with no direction', async ({ page }) => {
  test.setTimeout(180_000);
  const shot = overWhite(await renderSpec(page, 'stocks-index'));
  const off = diffPngs(scatterInk(shot, 16), shot, 'stocks-index');
  log('every inked pixel 16 levels either way', off);

  expect(off.meanDelta, 'the unsigned mean is the one that has to see it').toBeGreaterThan(MEAN_DELTA_DEFAULT);
  expectBlind(off, SPEC_BUDGETS, ['diff', 'tile', 'quad', 'bias']);
  // Not a budget, a fact about the case: this is a spec of text and a thin
  // line, so there is no interior to average over and the flat measure is
  // skipped rather than passed. It is what the unsigned mean is left covering.
  expect(off.flatSample, 'this case has no flat interior to sample').toBeLessThan(FLAT_MIN_SAMPLE);
});

/**
 * A blot of 6 pixels a side, black. Too small a share of the frame for the
 * pixel count or either average, and it fills too little of a 32px square for
 * the tile measure, but a block average inside it is the whole error.
 */
test('the worst block sees a small intense blot every other measure dilutes', async ({ page }) => {
  test.setTimeout(180_000);
  const shot = overWhite(await renderScene(page, 'symbol-variants'));
  const off = diffPngs(blot(shot, 192, 96, 6, 255), shot, 'symbol-variants');
  log('6px blot, 255 levels', off);

  expect(off.quadDelta, 'the worst block is the one that has to see it').toBeGreaterThan(QUAD_DELTA_DEFAULT);
  expectBlind(off, SCENE_BUDGETS, ['diff', 'tile', 'mean', 'bias', 'flat']);
  expect(off.flatSample, 'the flat measure applies here rather than being skipped').toBeGreaterThanOrEqual(
    FLAT_MIN_SAMPLE,
  );
});

/**
 * The same blot widened to 22 pixels and softened to 45 levels, which is over
 * the colour threshold and under the block budget. It fills half of one 32px
 * square and a two hundredth of the frame.
 *
 * On a spec, because a fixture cannot hold this case: 35% of a 32px square is
 * 358 pixels, which is already 0.24% of a 680x216 fixture against a 0.2%
 * budget, so on a frame that small the pixel count fires first whatever the
 * tile does. See README.md.
 */
test('the densest tile sees a blot the whole-frame count dilutes', async ({ page }) => {
  test.setTimeout(180_000);
  const shot = overWhite(await renderSpec(page, 'bar'));
  const off = diffPngs(blot(shot, 192, 96, 22, 45), shot, 'bar');
  log('22px blot, 45 levels', off);

  expect(off.worstTile, 'the densest tile is the one that has to see it').toBeGreaterThan(TILE_CHECK_DEFAULT);
  expectBlind(off, SPEC_BUDGETS, ['diff', 'quad', 'mean', 'bias', 'flat']);
  expect(off.flatSample, 'the flat measure applies here rather than being skipped').toBeGreaterThanOrEqual(
    FLAT_MIN_SAMPLE,
  );
});

/**
 * Five levels over the interiors only, the direction flipping every 16 pixels
 * so the signed mean cancels. A fill drawn in the wrong colour is exactly this,
 * and every whole-frame average is diluted by the edges around it.
 */
test('the flat-region mean sees an interior colour shift inside every other budget', async ({ page }) => {
  test.setTimeout(180_000);
  const shot = overWhite(await renderScene(page, 'symbol-variants'));
  const off = diffPngs(interiorShift(shot, 5, 16), shot, 'symbol-variants');
  log('interiors 5 levels either way', off);

  expect(off.flatSample, 'the flat measure needs its sample before it says anything').toBeGreaterThanOrEqual(
    FLAT_MIN_SAMPLE,
  );
  expect(off.flatMeanDelta, 'the flat-region mean is the one that has to see it').toBeGreaterThan(
    SCENE_FLAT_MEAN_DEFAULT,
  );
  expectBlind(off, SCENE_BUDGETS, ['diff', 'tile', 'quad', 'mean', 'bias']);
});

/**
 * A 32 row band moved two pixels sideways, which is every mark crossing it
 * drawn in the wrong place. The three colour measures are blind to it by
 * construction: a displacement takes ink off one edge and puts it on the other,
 * so the signed mean cancels, the unsigned mean is diluted by the ink that did
 * not move, and no pixel away from an edge changes at all.
 *
 * The worst block does see it, at 185 levels, and is the only other measure
 * that does. A spec is not held to the block, so on the spec suite this is the
 * pixel count alone.
 */
test('the pixel count sees a displaced mark the colour measures cannot', async ({ page }) => {
  test.setTimeout(180_000);
  const shot = overWhite(await renderSpec(page, 'bar'));
  const off = diffPngs(displaceRows(shot, 96, 128, 2), shot, 'bar');
  log('32 rows moved 2px sideways', off);

  expect(off.diffRatio, 'the pixel count is the one that has to see it').toBeGreaterThan(CROSS_CHECK_DEFAULT);
  expectBlind(off, SPEC_BUDGETS, ['tile', 'mean', 'bias', 'flat']);
  expect(off.flatSample, 'the flat measure applies here rather than being skipped').toBeGreaterThanOrEqual(
    FLAT_MIN_SAMPLE,
  );
  expect(off.quadDelta, 'the worst block sees a displaced mark too, on the cases held to it').toBeGreaterThan(
    QUAD_DELTA_DEFAULT,
  );
});
