/**
 * Per renderer timing for the demo page.
 *
 * Counting requestAnimationFrame ticks measures how often the browser can
 * service rAF, not how many frames a renderer drew. Canvas draws synchronously
 * and blocks rAF, while a gpu renderer submits and returns, so the two are not
 * comparable: at a million symbols the rAF count reads 2 against 30 without
 * either being frames on screen.
 *
 * So this counts renders instead, by wrapping each renderer's own entry point,
 * and reports the gpu time beside it where the renderer measures it.
 *
 * Compare mode watches both, one line each. The rate they share, since two
 * views on one page take turns on one thread and the slower one sets the pace,
 * and no way of driving them separates that short of a second thread, which a
 * vega View cannot run on. What is per renderer is the cost: the cpu column is
 * how long that renderer spent on its own render and the gpu column is what it
 * measured on the device, and those are the two numbers that say which is
 * faster.
 */
const fpsDisplay = document.getElementById('fpsDisplay');

/** Per renderer counters, keyed by which renderer they belong to. */
const stats = new Map();
let windowStart = performance.now();

/** Which renderer this is, by capability rather than class name. */
function kindOf(renderer) {
  return renderer?.wgOptions && typeof renderer.device === 'function' ? 'webgpu' : 'canvas';
}

/** Wraps a renderer so every completed render is counted and timed. */
function watchRenderer(renderer, label = kindOf(renderer)) {
  if (!renderer || renderer.__fpsWatched) {
    return renderer;
  }
  renderer.__fpsWatched = true;
  const entry = { renders: 0, cpu: 0, gpu: 0, gpuSamples: 0 };
  stats.set(label, entry);
  const inner = renderer.renderAsync.bind(renderer);
  renderer.renderAsync = async function (...args) {
    const start = performance.now();
    const result = await inner(...args);
    entry.cpu += performance.now() - start;
    entry.renders++;
    const gpu = renderer.gpuFrameTime;
    if (typeof gpu === 'number' && gpu > 0) {
      entry.gpu += gpu;
      entry.gpuSamples++;
    }
    return result;
  };
  return renderer;
}

/** Forgets every renderer, for a load that replaces the views. */
function resetRenderers() {
  stats.clear();
}

/** Keeps the renderers and zeroes their counts, for a change of what is running. */
function resetCounts() {
  for (const entry of stats.values()) {
    entry.renders = 0;
    entry.cpu = 0;
    entry.gpu = 0;
    entry.gpuSamples = 0;
  }
  windowStart = performance.now();
}

function report() {
  const elapsed = performance.now() - windowStart;
  if (elapsed < 500) {
    return;
  }
  const lines = [];
  for (const [label, s] of stats) {
    const fps = s.renders > 0 ? (s.renders * 1000) / elapsed : 0;
    const cpu = s.renders > 0 ? s.cpu / s.renders : 0;
    const gpu = s.gpuSamples > 0 ? s.gpu / s.gpuSamples : null;
    const name = stats.size > 1 ? `${label} ` : 'FPS: ';
    lines.push(
      `${name}${Math.round(fps)}  cpu ${cpu.toFixed(1)}ms` + (gpu === null ? '' : `  gpu ${gpu.toFixed(1)}ms`),
    );
    s.renders = 0;
    s.cpu = 0;
    s.gpu = 0;
    s.gpuSamples = 0;
  }
  fpsDisplay.innerText = lines.join('    ');
  windowStart = performance.now();
}

function tick() {
  report();
  requestAnimationFrame(tick);
}

tick();
window.watchRenderer = watchRenderer;
window.resetRenderers = resetRenderers;
window.resetRendererCounts = resetCounts;
