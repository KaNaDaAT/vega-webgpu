import { expect, test } from '@playwright/test';
import { collectPageErrors, harnessUrl, waitForRender } from './drive.js';

/**
 * A line with more points than its instances can be spread into an array.
 *
 * The batch collected them with `push(...values)`, which throws past about a
 * hundred and twenty five thousand values. At nineteen floats an instance that
 * is a line of some six and a half thousand points, which a dense time series
 * reaches, and what threw was the whole frame rather than the one mark.
 */
const POINTS = 12000;

interface Harness {
  renderer: {
    renderAsync: (scene: unknown) => Promise<unknown>;
    captureFrame: () => Promise<{ data: Uint8Array; width: number; height: number }>;
    _lastRender?: { scene?: { items?: { width?: number; height?: number }[] } };
  };
}

test('a line of twelve thousand points draws', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectPageErrors(page, { withConsole: true });

  await page.goto(harnessUrl('scene', 'line-shapes'));
  await waitForRender(page);

  const result = await page.evaluate(async (n: number) => {
    const r = (window as unknown as Harness).renderer;
    const group = r._lastRender?.scene?.items?.[0];
    const width = group?.width || 300;
    const height = group?.height || 200;
    const items = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      items.push({
        x: t * width,
        y: height / 2 + (height / 3) * Math.sin(i / 23),
        stroke: '#4c78a8',
        strokeWidth: 1,
        interpolate: 'linear',
      });
    }
    const scene = {
      marktype: 'group',
      name: 'root',
      role: 'frame',
      interactive: false,
      clip: false,
      items: [
        {
          x: 0,
          y: 0,
          width,
          height,
          items: [{ marktype: 'line', role: 'mark', interactive: false, clip: false, items }],
        },
      ],
    };
    try {
      await r.renderAsync(scene);
    } catch (err) {
      return { error: String(err), ink: 0 };
    }
    const shot = await r.captureFrame();
    const bg = [shot.data[0], shot.data[1], shot.data[2], shot.data[3]];
    let ink = 0;
    for (let i = 0; i < shot.data.length; i += 4) {
      for (let k = 0; k < 4; k++) {
        if (Math.abs(shot.data[i + k] - bg[k]) > 8) {
          ink++;
          break;
        }
      }
    }
    return { error: null as string | null, ink };
  }, POINTS);

  expect(result.error, `render threw: ${result.error}`).toBeNull();
  expect(errors, errors.join('\n')).toEqual([]);
  expect(result.ink).toBeGreaterThan(500);
});
