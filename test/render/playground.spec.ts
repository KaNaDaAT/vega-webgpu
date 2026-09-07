import { expect, test } from '@playwright/test';

/**
 * The mark playground states, per mark, whether each of five properties is
 * honoured. This drives the page and checks the claim against what the two
 * renderers actually draw, so implementing one of them without updating the
 * table fails here rather than shipping a page that lies.
 */
interface Shot {
  /** Share of pixels the two renderers put a different colour on. */
  diff: number;
  size: string;
}

/**
 * Where the two populations sit, measured: every honoured cell is under 0.25%
 * of pixels and every ignored one is over 0.46%, so 0.35% splits them. blend is
 * in neither list, since these examples are translucent and a blend over a
 * translucent source is inexact by design, at up to 3% here.
 */

/** A cell the table says we honour: the two renderers should agree. */
const HONOURED: [mark: string, feature: string][] = [
  ['symbol', 'gradientFill'],
  ['rect', 'gradientFill'],
  ['text', 'gradientFill'],
  ['text', 'gradientStroke'],
  ['line', 'strokeDash'],
  ['group', 'strokeDash'],
  ['line', 'strokeCap'],
];

/** A cell the table says we ignore: the two renderers should visibly differ. */
const IGNORED: [mark: string, feature: string][] = [
  ['symbol', 'gradientStroke'],
  ['rect', 'gradientStroke'],
  ['group', 'gradientStroke'],
  ['rule', 'strokeDash'],
  ['shape', 'strokeDash'],
  ['group', 'blend'],
  ['image', 'blend'],
];

test('the playground matches what its table claims', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/releases/marks.html?build=dev&view=both&mark=symbol');
  await page.waitForFunction(() => (window as unknown as { __views?: unknown[] }).__views?.length === 2, undefined, {
    timeout: 60_000,
  });

  const shoot = (mark: string, feature: string): Promise<Shot> =>
    page.evaluate(
      async ([m, f]) => {
        const sel = document.getElementById('mark') as HTMLSelectElement;
        sel.value = m;
        sel.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 250));
        for (const box of [...document.querySelectorAll('#features input')] as HTMLInputElement[]) {
          if (box.checked !== (box.dataset.key === f)) {
            box.click();
            await new Promise(r => setTimeout(r, 250));
          }
        }
        await new Promise(r => setTimeout(r, 700));

        const views = (window as unknown as { __views: { __renderer: string; _renderer: Record<string, unknown> }[] })
          .__views;
        const shots: Record<string, { px: Uint8ClampedArray | Uint8Array; w: number; h: number }> = {};
        for (const v of views) {
          const r = v._renderer as {
            captureFrame?: () => Promise<{ width: number; height: number; data: Uint8Array }>;
            _canvas?: HTMLCanvasElement;
          };
          if (v.__renderer === 'webgpu' && r.captureFrame) {
            const shot = await r.captureFrame();
            shots.webgpu = { px: shot.data, w: shot.width, h: shot.height };
          } else {
            const c = r._canvas as HTMLCanvasElement;
            const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
            shots.canvas = { px, w: c.width, h: c.height };
          }
        }
        const a = shots.canvas;
        const b = shots.webgpu;
        if (a.w !== b.w || a.h !== b.h) {
          return { diff: 1, size: `${a.w}x${a.h} vs ${b.w}x${b.h}` };
        }
        // both composited over white, then count the pixels that sit further
        // apart than antialiasing can account for
        let n = 0;
        for (let i = 0; i < a.px.length; i += 4) {
          const aa = a.px[i + 3] / 255;
          const ab = b.px[i + 3] / 255;
          let worst = 0;
          for (let k = 0; k < 3; k++) {
            const ca = a.px[i + k] * aa + 255 * (1 - aa);
            const cb = b.px[i + k] * ab + 255 * (1 - ab);
            worst = Math.max(worst, Math.abs(ca - cb));
          }
          if (worst > 24) n++;
        }
        return { diff: n / (a.w * a.h), size: `${a.w}x${a.h}` };
      },
      [mark, feature],
    );

  const pct = (d: number) => `${(d * 100).toFixed(3)}%`;
  const report: string[] = [];
  for (const [mark, feature] of HONOURED) {
    const { diff } = await shoot(mark, feature);
    report.push(`honoured ${mark}/${feature}: ${pct(diff)} of pixels differ`);
    expect(diff, `${mark} with ${feature} is listed as honoured, so the two should agree`).toBeLessThan(0.0035);
  }
  for (const [mark, feature] of IGNORED) {
    const { diff } = await shoot(mark, feature);
    report.push(`ignored  ${mark}/${feature}: ${pct(diff)} of pixels differ`);
    expect(diff, `${mark} with ${feature} is listed as ignored, so the two should differ`).toBeGreaterThan(0.0035);
  }
  console.log(report.join('\n'));
  expect(errors, errors.join('\n')).toEqual([]);
});
