/**
 * Frame rate for the demo page.
 *
 * Counting requestAnimationFrame ticks measures how often the browser can
 * service rAF, not how many frames a renderer drew. Canvas draws synchronously
 * and blocks rAF, while a gpu renderer submits and returns, so the two are not
 * comparable: at a million symbols the rAF count reads 2 against 30 without
 * either being frames on screen.
 *
 * So this counts renders instead, by wrapping the renderer's own entry point,
 * and reports the gpu time beside it where the renderer measures it.
 */
const fpsDisplay = document.getElementById('fpsDisplay');

let renders = 0;
let cpuTotal = 0;
let gpuTotal = 0;
let gpuSamples = 0;
let windowStart = performance.now();

/** Wraps a renderer so every completed render is counted and timed. */
function watchRenderer(renderer) {
  if (!renderer || renderer.__fpsWatched) {
    return renderer;
  }
  renderer.__fpsWatched = true;
  const inner = renderer.renderAsync.bind(renderer);
  renderer.renderAsync = async function (...args) {
    const start = performance.now();
    const result = await inner(...args);
    cpuTotal += performance.now() - start;
    renders++;
    const gpu = renderer.gpuFrameTime;
    if (typeof gpu === 'number' && gpu > 0) {
      gpuTotal += gpu;
      gpuSamples++;
    }
    return result;
  };
  return renderer;
}

function report() {
  const elapsed = performance.now() - windowStart;
  if (elapsed < 500) {
    return;
  }
  const fps = renders > 0 ? (renders * 1000) / elapsed : 0;
  const cpu = renders > 0 ? cpuTotal / renders : 0;
  const gpu = gpuSamples > 0 ? gpuTotal / gpuSamples : null;
  fpsDisplay.innerText =
    `FPS: ${Math.round(fps)}  cpu ${cpu.toFixed(1)}ms` + (gpu === null ? '' : `  gpu ${gpu.toFixed(1)}ms`);
  renders = 0;
  cpuTotal = 0;
  gpuTotal = 0;
  gpuSamples = 0;
  windowStart = performance.now();
}

function tick() {
  report();
  requestAnimationFrame(tick);
}

tick();
window.watchRenderer = watchRenderer;
