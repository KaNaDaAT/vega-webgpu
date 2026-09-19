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
 * What a property is allowed to add to its mark on its own, and the floor under
 * a mark that costs nothing. Every honoured cell adds under 0.38 points of
 * differing pixels, and every cell that was ignored added over 4.4 before it
 * was implemented, so 0.35 splits them with an order of magnitude either side. blend is in neither list, since these
 * examples are translucent and a blend over a translucent source is inexact by
 * design, at up to 3% here.
 */
const SPLIT = 0.0035;

/** A cell the table says we honour: the two renderers should agree. */
const HONOURED: [mark: string, feature: string][] = [
  ['group', 'blend'],
  ['image', 'blend'],
  ['symbol', 'gradientFill'],
  ['symbol', 'gradientStroke'],
  ['rect', 'gradientStroke'],
  ['group', 'gradientStroke'],
  ['line', 'gradientStroke'],
  ['rule', 'gradientStroke'],
  ['rule', 'strokeCap'],
  ['rect', 'gradientFill'],
  ['text', 'gradientFill'],
  ['text', 'gradientStroke'],
  ['line', 'strokeDash'],
  ['rule', 'strokeDash'],
  ['group', 'strokeDash'],
  ['area', 'strokeDash'],
  ['path', 'strokeDash'],
  ['shape', 'strokeDash'],
  ['symbol', 'strokeDash'],
  ['trail', 'strokeDash'],
  ['rect', 'strokeDash'],
  ['arc', 'strokeDash'],
  ['line', 'strokeCap'],
  ['path', 'strokeCap'],
  ['area', 'strokeCap'],
  ['shape', 'strokeCap'],
];

/**
 * A cell the table says we ignore: the two renderers should visibly differ.
 * Empty, since the table has no `no` left in it. The loop stays, so a cell that
 * goes back to being ignored is checked in that direction too.
 */
const IGNORED: [mark: string, feature: string][] = [];

test('the playground matches what its table claims', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/releases/marks.html?build=dev&view=both&mark=symbol&offscreen=1');
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

  /**
   * What the mark already costs with nothing ticked, so a property is judged by
   * what it adds rather than by where its mark starts. Some marks are over the
   * split before any property is on, and holding those to an absolute number
   * would report a property as ignored when it is drawn.
   *
   * A property costs a share of what the mark already costs and a fixed amount
   * on top, so the bar carries both. Three times the mark, because a property
   * legitimately adds edges: a dash cuts one stroke into a dozen, and every new
   * end is another antialiased edge that can land a pixel either way. Plus the
   * split, because that addition does not shrink when the mark itself gets
   * better. A multiple on its own held until arc's solid cell went from 0.451%
   * of pixels to 0.156% and took the bar under arc's own dash at 0.535%, which
   * had improved from 0.748% in the same change.
   *
   * It separated the two populations by a wide margin while there were two:
   * every ignored cell differed on 4.4% to 6.4% of pixels and the worst
   * honoured one on 0.54%.
   */
  const plain = new Map<string, number>();
  const bar = async (mark: string): Promise<number> => {
    if (!plain.has(mark)) {
      plain.set(mark, (await shoot(mark, '')).diff);
    }
    const base = plain.get(mark) as number;
    return SPLIT + base * 3;
  };

  for (const [mark, feature] of HONOURED) {
    const limit = await bar(mark);
    const { diff } = await shoot(mark, feature);
    report.push(`honoured ${mark}/${feature}: ${pct(diff)} of pixels differ, allowed ${pct(limit)}`);
    expect(diff, `${mark} with ${feature} is listed as honoured, so the two should agree`).toBeLessThan(limit);
  }
  for (const [mark, feature] of IGNORED) {
    const limit = await bar(mark);
    const { diff } = await shoot(mark, feature);
    report.push(`ignored  ${mark}/${feature}: ${pct(diff)} of pixels differ, needs over ${pct(limit)}`);
    expect(diff, `${mark} with ${feature} is listed as ignored, so the two should differ`).toBeGreaterThan(limit);
  }
  console.log(report.join('\n'));
  expect(errors, errors.join('\n')).toEqual([]);
});
