import { expect, test, type Page } from '@playwright/test';
import { installGpuProbe } from './gpu-probe.js';

/**
 * Narrows down what kills the GPU device on a runner.
 *
 * An idle device survives three seconds, but rendering an empty scene destroys
 * it within milliseconds, at either sample count and with no mark drawn. That
 * puts the trigger in the canvas render path rather than anywhere in the mark
 * code, so these cases use raw WebGPU with none of the renderer involved.
 *
 * Diagnostic only: it reports and never fails, and it is off unless
 * WEBGPU_DIAGNOSE is set, since the question it answers is settled. Run it with
 * `cross-env WEBGPU_DIAGNOSE=1 npx playwright test webgpu-smoke-diagnose` when a
 * device starts dying again.
 */
const HARNESS = 'http://127.0.0.1:8123/test/render/harness.html';

type Case =
  | 'idle'
  | 'offscreen'
  | 'canvas-configure-opaque'
  | 'canvas-configure-premultiplied'
  | 'canvas-gettexture'
  | 'canvas-pass-opaque'
  | 'canvas-pass-premultiplied';

const CASES: Case[] = [
  'idle',
  'offscreen',
  'canvas-configure-opaque',
  'canvas-configure-premultiplied',
  'canvas-gettexture',
  'canvas-pass-opaque',
  'canvas-pass-premultiplied',
];

interface Outcome {
  label: string;
  lost: string | null;
  note: string;
  timeline: string[];
}

async function run(page: Page, kind: Case): Promise<Outcome> {
  await page.goto(HARNESS);
  const result = await page.evaluate(async (which: string) => {
    const w = window as unknown as { __gpuLog?: string[] };
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) {
      return { lost: 'no adapter', note: '', timeline: w.__gpuLog ?? [] };
    }
    const device = await adapter.requestDevice();
    let lost: string | null = null;
    device.lost.then(info => (lost = `${info.reason}: ${info.message}`));

    const format = navigator.gpu.getPreferredCanvasFormat();
    const clear = (view: GPUTextureView, resolveTarget?: GPUTextureView) => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view, resolveTarget, clearValue: { r: 1, g: 1, b: 1, a: 1 }, loadOp: 'clear', storeOp: 'store' },
        ],
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
    };
    const canvasContext = (alphaMode: GPUCanvasAlphaMode) => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 70;
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('webgpu') as GPUCanvasContext;
      ctx.configure({ device, format, usage: GPUTextureUsage.RENDER_ATTACHMENT, alphaMode });
      return ctx;
    };

    let note = which;
    try {
      if (which === 'offscreen') {
        const texture = device.createTexture({
          size: [100, 70, 1],
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        clear(texture.createView());
      } else if (which === 'canvas-configure-opaque') {
        canvasContext('opaque');
      } else if (which === 'canvas-configure-premultiplied') {
        canvasContext('premultiplied');
      } else if (which === 'canvas-gettexture') {
        canvasContext('opaque').getCurrentTexture();
      } else if (which === 'canvas-pass-opaque') {
        clear(canvasContext('opaque').getCurrentTexture().createView());
      } else if (which === 'canvas-pass-premultiplied') {
        clear(canvasContext('premultiplied').getCurrentTexture().createView());
      }
      await device.queue.onSubmittedWorkDone().catch(() => {});
    } catch (err) {
      note = `${which} threw: ${String(err)}`;
    }
    await new Promise(resolve => setTimeout(resolve, 800));
    return { lost, note, timeline: w.__gpuLog ?? [] };
  }, kind);
  return { label: kind, ...result };
}

test('what kills the gpu device', async ({ page }) => {
  test.skip(!process.env.WEBGPU_DIAGNOSE, 'set WEBGPU_DIAGNOSE=1 to run the device bisect');
  test.setTimeout(300_000);
  await installGpuProbe(page);

  const outcomes: Outcome[] = [];
  for (const kind of CASES) {
    outcomes.push(await run(page, kind));
  }

  const report = outcomes
    .map(o => `${o.lost ? 'LOST' : 'ALIVE'} ${o.label}\n     ${o.note}\n     ${o.timeline.join('\n     ')}`)
    .join('\n');
  console.log(`\n=== what kills the gpu device ===\n${report}\n=== end ===\n`);
  expect(outcomes.length).toBe(CASES.length);
});
