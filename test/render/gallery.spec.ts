import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { summary } from '../../scripts/run-summary.mjs';

/**
 * The gallery and the run summary say which cases failed, read back out of a
 * run's manifest with the suite's own gate. The runs are served in place of
 * the hosted history, so nothing here needs a GPU or a recorded run on disk.
 */

const budgets = { diff: 0.008, tile: 0.35, mean: 26, bias: 2, flat: 3 };
const row = (name: string, bias: number) => ({
  name,
  kind: 'spec',
  file: name,
  width: 2,
  height: 2,
  diff: 0,
  touched: 0,
  tile: 0,
  mean: 1,
  bias,
  flat: 0,
  flatSample: 0,
  quad: 0,
  ink: 0.5,
  budgets,
});
const images = Object.fromEntries(
  ['bar', 'line-curves'].flatMap(name => ['canvas', 'webgpu'].map(kind => [`${name}-${kind}.png`, 'white'])),
);
const manifest = (sha: string, cases: ReturnType<typeof row>[]) => ({
  generated: '2026-10-04T09:34:41.858Z',
  run: { sha, version: '2.0.0', repo: null, url: null },
  settings: null,
  cases,
  images,
});

const failing = manifest('aaaaaaa000', [row('bar', 0.4), row('line-curves', 2.09)]);
const passing = manifest('bbbbbbb000', [row('bar', 0.4), row('line-curves', 0.35)]);
const index = {
  format: 1,
  runs: [
    { id: 'bbbbbbb', sha: 'bbbbbbb000', version: '2.0.0', release: null, url: null, cases: 2, failed: [] },
    { id: 'aaaaaaa', sha: 'aaaaaaa000', version: '2.0.0', release: null, url: null, cases: 2, failed: ['line-curves'] },
  ],
};

async function serveRuns(page: Page) {
  const white = new PNG({ width: 2, height: 2 });
  white.data.fill(255);
  const png = PNG.sync.write(white);
  await page.route('**/test/render/runs/index.json', r => r.fulfill({ json: index }));
  await page.route('**/test/render/runs/aaaaaaa.json', r => r.fulfill({ json: failing }));
  await page.route('**/test/render/runs/bbbbbbb.json', r => r.fulfill({ json: passing }));
  await page.route('**/test/render/runs/png/*.png', r => r.fulfill({ body: png, contentType: 'image/png' }));
}

test('a failed run is red in the run picker, and so is its failed case in the list and on the case', async ({
  page,
}) => {
  await serveRuns(page);
  await page.goto('/test/render/gallery.html?run=aaaaaaa');

  const pick = page.locator('#run');
  await expect(pick).toHaveClass(/failed/);
  await expect(pick.locator('option[value="aaaaaaa"]')).toHaveClass('failed');
  await expect(pick.locator('option[value="aaaaaaa"]')).toContainText('1 failed');
  await expect(pick.locator('option[value="bbbbbbb"]')).not.toHaveClass('failed');

  // first in the list and opened, though it sorts after bar on every measure
  await expect(page.locator('#list .case').first()).toHaveAttribute('data-file', 'line-curves');
  await expect(page.locator('#list .case.failed')).toHaveCount(1);
  await expect(page.locator('#note p.failed')).toContainText('bias 2.09, over the 2 allowed');
  await expect(page.locator('#runInfo .fails a')).toHaveAttribute('href', '#line-curves');
});

test('a run that passed is not marked, and still shows which other run failed', async ({ page }) => {
  await serveRuns(page);
  await page.goto('/test/render/gallery.html?run=bbbbbbb');

  await expect(page.locator('#list .case')).toHaveCount(2);
  await expect(page.locator('#run')).not.toHaveClass(/failed/);
  await expect(page.locator('#list .case.failed')).toHaveCount(0);
  await expect(page.locator('#note p.failed')).toHaveCount(0);
  await expect(page.locator('#run option[value="aaaaaaa"]')).toHaveClass('failed');
});

test('the run summary names a failed case and links it in the gallery', () => {
  const text = summary({
    manifest: failing,
    env: {
      RENDER_DPR: '1',
      GITHUB_SHA: 'aaaaaaa000',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      IMAGES_URL: 'https://example.com/images',
    },
  });
  expect(text).toContain('**1 over budget**');
  expect(text).toContain(
    '| `line-curves` | bias 2.09, over the 2 allowed | ' +
      '[open](https://kanadaat.github.io/vega-webgpu/gallery/?run=aaaaaaa#line-curves) |',
  );
  expect(text).toContain('[the images](https://example.com/images)');
  expect(text).not.toContain('`bar`');
});
