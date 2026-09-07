import { expect, test } from '@playwright/test';

interface Shot {
  name: string;
  width: number;
  height: number;
  ink: number;
  error?: string;
}

/**
 * Several views on one page, each with its own canvas, renderer and device.
 * Mark resources, pipelines and the geometry caches all hang off the canvas
 * context, so one view leaking into another shows up as a blank or wrong chart.
 */
test('several webgpu views render side by side', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/test/render/harness.html?spec=bar&renderer=webgpu');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout: 90_000 },
  );

  const out = await page.evaluate(async (): Promise<{ shots: Shot[]; alone: Shot | null }> => {
    const vega = (window as unknown as { vega: Record<string, (...a: unknown[]) => unknown> }).vega;

    const inkOf = (shot: { width: number; height: number; data: Uint8Array }) => {
      let n = 0;
      for (let i = 0; i < shot.data.length; i += 4) {
        const a = shot.data[i + 3] / 255;
        for (let c = 0; c < 3; c++) {
          if (shot.data[i + c] * a + 255 * (1 - a) < 240) {
            n++;
            break;
          }
        }
      }
      return n / (shot.width * shot.height);
    };

    const build = async (name: string) => {
      const spec = await fetch(`/test/specs-valid/${name}.vg.json`).then(r => r.json());
      const el = document.createElement('div');
      document.body.appendChild(el);
      const view = new (vega.View as unknown as new (r: unknown, o: unknown) => Record<string, unknown>)(
        (vega.parse as (s: unknown) => unknown)(spec),
        { renderer: 'webgpu', container: el },
      );
      const options = (view._renderer as { wgOptions?: { offscreen: boolean } })?.wgOptions;
      if (options) {
        options.offscreen = true;
      }
      await (view.runAsync as () => Promise<unknown>)();
      return view;
    };

    const names = ['bar', 'arc', 'scatter-plot'];
    const views = [];
    for (const n of names) views.push(await build(n));

    const shoot = async (view: Record<string, unknown>, name: string): Promise<Shot> => {
      const r = view._renderer as Record<string, unknown>;
      try {
        const shot = (await (
          r.captureFrame as () => Promise<{ width: number; height: number; data: Uint8Array }>
        )()) as {
          width: number;
          height: number;
          data: Uint8Array;
        };
        return { name, width: shot.width, height: shot.height, ink: inkOf(shot) };
      } catch (err) {
        return { name, width: 0, height: 0, ink: 0, error: String(err) };
      }
    };

    // all three live at once
    const shots: Shot[] = [];
    for (let i = 0; i < views.length; i++) shots.push(await shoot(views[i], names[i]));

    // the same spec on its own, as the reference for what it should look like
    for (const v of views) (v.finalize as () => void)();
    const solo = await build('arc');
    const alone = await shoot(solo, 'arc alone');
    (solo.finalize as () => void)();

    return { shots, alone };
  });

  console.log(JSON.stringify(out, null, 1));
  for (const s of out.shots) {
    expect(s.error, `${s.name} failed to capture`).toBeUndefined();
    expect(s.ink, `${s.name} drew nothing`).toBeGreaterThan(0.01);
  }
  const arc = out.shots.find(s => s.name === 'arc')!;
  expect(out.alone!.ink, 'arc alongside others should match arc on its own').toBeCloseTo(arc.ink, 2);
});

/** Attachments and cached geometry are sized to the canvas, so a resize has to reach them. */
test('a resized view redraws at the new size', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/test/render/harness.html?spec=bar&renderer=webgpu');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout: 90_000 },
  );
  const out = await page.evaluate(async () => {
    const view = (
      window as unknown as {
        view: {
          width: (n?: number) => unknown;
          height: (n?: number) => unknown;
          runAsync: () => Promise<unknown>;
          _renderer: Record<string, unknown>;
        };
      }
    ).view;
    const r = view._renderer;
    const capture = r.captureFrame as () => Promise<{ width: number; height: number; data: Uint8Array }>;
    const ink = (s: { width: number; height: number; data: Uint8Array }) => {
      let n = 0;
      for (let i = 0; i < s.data.length; i += 4) {
        const a = s.data[i + 3] / 255;
        for (let c = 0; c < 3; c++) {
          if (s.data[i + c] * a + 255 * (1 - a) < 240) {
            n++;
            break;
          }
        }
      }
      return n / (s.width * s.height);
    };

    const steps = [];
    for (const [w, h] of [
      [400, 200],
      [900, 500],
      [250, 160],
      [400, 200],
    ]) {
      view.width(w);
      view.height(h);
      await view.runAsync();
      const shot = await capture.call(r);
      steps.push({ asked: [w, h], got: [shot.width, shot.height], ink: +ink(shot).toFixed(4) });
    }
    return steps;
  });
  console.log(JSON.stringify(out));
  for (const s of out) {
    expect(s.ink, `${s.asked.join('x')} drew nothing`).toBeGreaterThan(0.01);
  }
  // back at the starting size the picture has to come back the same
  expect(out[3].got).toEqual(out[0].got);
  expect(out[3].ink).toBeCloseTo(out[0].ink, 3);
});

/** A lost device takes every pipeline, texture and buffer with it. */
test('a view recovers from a lost device', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/test/render/harness.html?spec=bar&renderer=webgpu');
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __renderDone?: boolean; __renderError?: string };
      return w.__renderDone || w.__renderError;
    },
    undefined,
    { timeout: 90_000 },
  );
  const out = await page.evaluate(async () => {
    const view = (
      window as unknown as {
        view: { runAsync: () => Promise<unknown>; _renderer: Record<string, unknown> };
      }
    ).view;
    const r = view._renderer;
    const capture = r.captureFrame as () => Promise<{ width: number; height: number; data: Uint8Array }>;
    const ink = (s: { width: number; height: number; data: Uint8Array }) => {
      let n = 0;
      for (let i = 0; i < s.data.length; i += 4) {
        const a = s.data[i + 3] / 255;
        for (let c = 0; c < 3; c++) {
          if (s.data[i + c] * a + 255 * (1 - a) < 240) {
            n++;
            break;
          }
        }
      }
      return n / (s.width * s.height);
    };

    const before = +ink(await capture.call(r)).toFixed(4);
    const firstDevice = r._device;
    (r._device as GPUDevice).destroy();
    await new Promise(res => setTimeout(res, 200));
    await view.runAsync();
    const after = +ink(await capture.call(r)).toFixed(4);
    return { before, after, deviceReplaced: r._device !== firstDevice, generation: r.deviceGeneration };
  });
  console.log(JSON.stringify(out));
  expect(out.deviceReplaced, 'the lost device should be replaced').toBe(true);
  expect(out.after, 'the picture should come back after a device loss').toBeCloseTo(out.before, 3);
});
