import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * The wipe stacks the two renderers, so the top one has to cover the bottom
 * one. A canvas is transparent wherever nothing was drawn, so a mark only one
 * of them has would otherwise show through on both sides of the divider.
 */
test('the top layer covers the one under it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/test/?spec=bar&renderer=webgpu&version=dev&compare=1&offscreen=1');
  await page.waitForFunction(
    () => (window as unknown as { __compared?: unknown[] }).__compared?.length === 2,
    undefined,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(500);

  // a marker on the bottom canvas, standing in for a mark only it drew, with
  // the wipe deciding how much of the top layer covers it
  const paint = (wipeAt: string) =>
    page.evaluate(at => {
      const wipe = document.querySelector('#wipe') as HTMLInputElement;
      wipe.value = at;
      wipe.dispatchEvent(new Event('input'));
      const canvas = document.querySelector('#visA canvas') as HTMLCanvasElement;
      const c2d = canvas.getContext('2d')!;
      c2d.fillStyle = '#ff00ff';
      c2d.fillRect(0, 0, canvas.width, canvas.height);
      return true;
    }, wipeAt);

  const magentaNow = async () => {
    const shot = PNG.sync.read(await page.locator('#overlay').screenshot());
    let magenta = 0;
    for (let i = 0; i < shot.data.length; i += 4) {
      if (shot.data[i] > 200 && shot.data[i + 1] < 60 && shot.data[i + 2] > 200) {
        magenta++;
      }
    }
    return magenta;
  };

  // the whole width goes to the top layer, so nothing of the bottom is meant
  // to be visible
  expect(await paint('0')).toBe(true);
  expect(await magentaNow(), 'nothing of the bottom layer shows through').toBe(0);

  // and the other way round, so a screenshot that sees nothing at all cannot
  // pass the check above
  expect(await paint('100')).toBe(true);
  expect(await magentaNow(), 'the bottom layer is what the screenshot sees at the far wipe').toBeGreaterThan(0);
});

/**
 * wipe, blink and side by side are three readings of the same two layers. Blink
 * has to put the divider away, side by side has to stop stacking them, and none
 * of the three may rebuild the views, since a rebuild is what would let the two
 * drift onto different frames.
 */
test('the three view modes rearrange the same two layers', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/test/?spec=bar&renderer=webgpu&version=dev&compare=1&offscreen=1');
  await page.waitForFunction(() => document.querySelectorAll('#panels canvas').length === 2, undefined, {
    timeout: 60_000,
  });

  const read = () =>
    page.evaluate(() => {
      const overlay = document.querySelector('#overlay') as HTMLElement;
      const top = document.querySelector('.layer.top') as HTMLElement;
      return {
        classes: overlay.className,
        animation: getComputedStyle(top).animationName,
        clip: getComputedStyle(top).clipPath,
        topPosition: getComputedStyle(top).position,
        divider: getComputedStyle(overlay, '::after').display,
        wipeIdle: (document.querySelector('#wipeControls') as HTMLElement).classList.contains('idle'),
        canvases: document.querySelectorAll('#panels canvas').length,
        duration: getComputedStyle(top).animationDuration,
        // each layer carries its own label, which is what lets blink name what
        // is on screen: the top one fades with the layer it sits in
        labels: [...document.querySelectorAll('#overlay .side')].map(el => ({
          text: el.textContent,
          inTop: !!el.closest('.layer.top'),
          left: getComputedStyle(el).left,
        })),
      };
    });
  const press = (mode: string) => page.locator(`#viewModes button[data-view="${mode}"]`).click();

  const wipe = await read();
  expect(wipe.animation, 'a fresh page shows the wipe, so nothing animates').toBe('none');
  expect(wipe.clip, 'and the top layer is clipped to the divider').not.toBe('none');
  expect(wipe.wipeIdle, 'the slider is live').toBe(false);

  expect(
    wipe.labels.map(l => `${l.text}:${l.inTop}`),
    'one label per layer, naming it',
  ).toEqual(['canvas:false', 'webgpu:true']);
  expect(new Set(wipe.labels.map(l => l.left)).size, 'wiping, each sits on its own side of the divider').toBe(2);

  // the rate lives in the row's blink slot, which only shows in blink mode
  await press('blink');
  await page.selectOption('#blinkRate', '2s');
  const blink = await read();
  expect(blink.duration, 'the rate control reaches the animation').toBe('2s');
  expect(
    new Set(blink.labels.map(l => l.left)).size,
    'blinking, both sit in the same corner so only the visible one reads',
  ).toBe(1);
  expect(blink.animation, 'the top layer alternates').toBe('blink');
  expect(blink.clip, 'showing whole rather than clipped').toBe('none');
  expect(blink.divider, 'a divider across an alternating image means nothing').toBe('none');
  expect(blink.wipeIdle, 'and the slider has nothing to place').toBe(true);

  await press('side');
  const side = await read();
  expect(side.classes, 'side by side is a class on the same overlay').toContain('side');
  expect(side.topPosition, 'so the top layer stops being stacked on the other').toBe('static');
  expect(side.divider, 'and there is no divider between two columns').toBe('none');

  await press('wipe');
  const back = await read();
  expect(back.animation, 'and back again').toBe('none');
  expect(back.wipeIdle).toBe(false);
  expect(back.clip).not.toBe('none');
  expect(back.canvases, 'no mode rebuilt the views').toBe(wipe.canvases);
});
