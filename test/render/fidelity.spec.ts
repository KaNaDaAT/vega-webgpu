import { expect, test, type Page } from '@playwright/test';
import { channelStats, diffPngs, renderInHarness, type RendererName } from './compare.js';
import { renderSpecs } from './specs.js';
import { renderScenes } from './scenes.js';

/**
 * Ranks every spec and fixture by how far its render is from canvas, so the
 * least faithful features are visible in one place rather than spread across
 * per-spec budgets.
 *
 * Three numbers, because they say different things: `diff` is the share of
 * pixels that moved, `max` is how wrong the worst pixel is, and `mean` is the
 * average error over inked pixels. A soft antialiasing difference shows a high
 * diff and a low max; a misplaced mark shows the reverse.
 *
 * Diagnostic only: it reports and never fails, and is off unless
 * WEBGPU_FIDELITY is set. `npx cross-env WEBGPU_FIDELITY=1 playwright test fidelity`
 */
function specUrl(name: string, renderer: RendererName): string {
  return `/test/render/harness.html?spec=${encodeURIComponent(name)}&renderer=${renderer}`;
}

function sceneUrl(name: string, renderer: RendererName): string {
  return `/test/render/scene-harness.html?scene=${encodeURIComponent(name)}&renderer=${renderer}`;
}

interface Row {
  name: string;
  kind: string;
  diff: number;
  max: number;
  mean: number;
}

async function measure(page: Page, name: string, kind: string, url: (n: string, r: RendererName) => string) {
  const webgpu = await renderInHarness(page, url(name, 'webgpu'), 'webgpu');
  const canvas = await renderInHarness(page, url(name, 'canvas'), 'canvas');
  const { diffRatio } = diffPngs(webgpu.png, canvas.png, name);
  const stats = channelStats(webgpu.png, canvas.png);
  return { name, kind, diff: diffRatio, max: stats.max, mean: stats.mean };
}

test('fidelity against canvas', async ({ page }) => {
  test.skip(!process.env.WEBGPU_FIDELITY, 'set WEBGPU_FIDELITY=1 to run the fidelity report');
  test.setTimeout(1_800_000);

  const rows: Row[] = [];
  for (const name of renderScenes) {
    rows.push(await measure(page, name, 'fixture', sceneUrl));
  }
  for (const name of renderSpecs) {
    rows.push(await measure(page, name, 'spec', specUrl));
  }

  const fmt = (r: Row) =>
    `  ${r.name.padEnd(26)} ${(r.diff * 100).toFixed(3).padStart(7)}%  max ${String(r.max).padStart(3)}  mean ${r.mean.toFixed(2).padStart(6)}  ${r.kind}`;

  const byMax = [...rows].sort((a, b) => b.max - a.max);
  const byMean = [...rows].sort((a, b) => b.mean - a.mean);
  const exact = rows.filter(r => r.max <= 2).length;

  /** How many cases sit in each band, so the shape of the corpus is one line. */
  const bands = (pick: (r: Row) => number, edges: number[]) =>
    edges
      .map((edge, i) => {
        const low = i === 0 ? 0 : edges[i - 1];
        const n = rows.filter(r => pick(r) > low && pick(r) <= edge).length;
        return `${low}-${edge}: ${n}`;
      })
      .concat(`over ${edges[edges.length - 1]}: ${rows.filter(r => pick(r) > edges[edges.length - 1]).length}`)
      .join('   ');

  console.log(
    [
      '',
      '=== fidelity against canvas ===',
      `${rows.length} cases, ${exact} matching canvas to within 2 levels everywhere`,
      `by max channel error   ${bands(r => r.max, [2, 8, 32, 128])}`,
      `by mean channel error  ${bands(r => r.mean, [1, 2, 4, 8])}`,
      '',
      'worst by max channel error (a misplaced or missing mark):',
      ...byMax.slice(0, 15).map(fmt),
      '',
      'worst by mean channel error over inked pixels (a systematic difference):',
      ...byMean.slice(0, 15).map(fmt),
      '=== end ===',
      '',
    ].join('\n'),
  );
  expect(rows.length).toBeGreaterThan(0);
});
