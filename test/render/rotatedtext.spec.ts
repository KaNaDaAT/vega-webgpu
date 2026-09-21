import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { renderInHarness, renderRatio } from './compare.js';

/**
 * A rotated label is rasterized one of two ways. Normally the rotation is
 * baked into the atlas cell and the quad is axis aligned. When an atlas upload
 * passes its budget the renderer drops to rasterizing the label upright and
 * turning the quad instead, which a label that only moves does not have to be
 * re-rasterized for.
 *
 * `wordcloud` at 200% zoom showed labels jumping as the switch happened under
 * hover, and this measures that jump: where the ink is, rather than which
 * pixels it covers.
 *
 * The two cannot be made to agree. The browser hints a glyph along its
 * baseline, so asking it for a rotated glyph and asking it for an upright one
 * gives two different rasterizations, not one resampled into the other: at 90
 * and 270 degrees the upright glyph carries 12% more ink. Measured with a
 * nearest sampler and with a linear one, and with the sub-pixel phase
 * quantized and not, and all four read the same, which rules out filtering
 * and placement as the cause.
 *
 * So the baked path is held to matching canvas, and the fallback is held to
 * not drifting further than it does today.
 */

/** Ink centroid and mass inside a box, so one label can be measured alone. */
function cell(buf: Buffer, x0: number, y0: number, x1: number, y1: number): { mass: number; cx: number; cy: number } {
  const img = PNG.sync.read(buf);
  let mass = 0;
  let sx = 0;
  let sy = 0;
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
      const i = (y * img.width + x) * 4;
      // over white, so ink is darkness
      const w = 255 - Math.min(img.data[i], img.data[i + 1], img.data[i + 2]);
      mass += w;
      sx += x * w;
      sy += y * w;
    }
  }
  return { mass, cx: sx / mass, cy: sy / mass };
}

/** The angles text-rotated draws, in the order it lays them out. */
const ANGLES = [0, 15, 30, 45, 60, 90, 120, 135, 180, 270];

async function renderRotated(page: Page, renderer: 'webgpu' | 'canvas', exact: boolean): Promise<Buffer> {
  const shot = await renderInHarness(
    page,
    `/test/render/scene-harness.html?scene=text-rotated&renderer=${renderer}&exactRotatedText=${exact ? 1 : 0}`,
    renderer,
  );
  return shot.png;
}

test('both rotated text paths put a label where canvas does', async ({ page }) => {
  test.setTimeout(180_000);
  const truthPng = await renderRotated(page, 'canvas', true);
  const bakedPng = await renderRotated(page, 'webgpu', true);
  const spunPng = await renderRotated(page, 'webgpu', false);

  let worstBaked = 0;
  let worstSpun = 0;
  const rows: string[] = [];
  // The fixture lays its labels out in scene units and the pngs are device
  // pixels, so the boxes scale and the offsets come back to scene units. One
  // threshold then covers either ratio.
  const r = renderRatio();
  for (let i = 0; i < ANGLES.length; i++) {
    const cx = (60 + (i % 5) * 120) * r;
    const cy = (60 + Math.floor(i / 5) * 130) * r;
    const box = [cx - 58 * r, cy - 62 * r, cx + 58 * r, cy + 62 * r] as const;
    const truth = cell(truthPng, ...box);
    const baked = cell(bakedPng, ...box);
    const spun = cell(spunPng, ...box);
    const offBaked = Math.hypot(baked.cx - truth.cx, baked.cy - truth.cy) / r;
    const offSpun = Math.hypot(spun.cx - truth.cx, spun.cy - truth.cy) / r;
    worstBaked = Math.max(worstBaked, offBaked);
    worstSpun = Math.max(worstSpun, offSpun);
    rows.push(
      `ROTATED ${String(ANGLES[i]).padStart(3)}deg baked ${offBaked.toFixed(3)} spun ${offSpun.toFixed(3)} ` +
        `mass ${truth.mass.toFixed(0)}/${baked.mass.toFixed(0)}/${spun.mass.toFixed(0)}`,
    );
  }
  console.log(rows.join('\n'));
  console.log(`ROTATED worst baked ${worstBaked.toFixed(3)}px, worst spun ${worstSpun.toFixed(3)}px`);

  expect(worstBaked, 'the baked path is canvas rasterizing the rotation, so it has to match').toBeLessThan(0.2);
  // Measured worst 1.085 at 270 degrees, which is the hinting difference
  // rather than anything placement can fix. Held so it cannot grow.
  expect(worstSpun, 'the fallback path drifted further from canvas than it used to').toBeLessThan(1.3);
});
