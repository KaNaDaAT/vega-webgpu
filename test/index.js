const urlParams = new URLSearchParams(window.location.search);
const urlSpec = urlParams.get('spec');
const urlRenderer = urlParams.get('renderer') ?? 'webgpu';
const urlVersion = window.__rendererVersion ?? urlParams.get('version') ?? 'dev';
const urlCompare = urlParams.get('compare') === '1';
const urlDiff = urlParams.get('diff') === '1';

const releaseVersions = typeof vegaWebGPURendererVersions !== 'undefined' ? vegaWebGPURendererVersions : [];

let view, selectedSpec, selectedRenderer, selectedVersion;
let showCompare = false;
let showDiff = false;
// compare and diff modes run one view per renderer, kept here so they can all
// be finalized when the spec or mode changes
let compared = [];

const selectSpec = document.querySelector('#specs');
selectSpec.addEventListener('change', function () {
  selectedSpec = selectSpec.options[selectSpec.selectedIndex].value;
  updateUrl();
  load(selectedSpec);
});

const selectRenderer = document.querySelector('#render');
selectRenderer.addEventListener('change', function () {
  selectedRenderer = selectRenderer.options[selectRenderer.selectedIndex].value;
  updateUrl();
  if (view) {
    view.renderer(selectedRenderer);
    view.runAsync();
    configureWebGPU();
  }
});

const checkCompare = document.querySelector('#compare');
const checkDiff = document.querySelector('#diff');
for (const box of [checkCompare, checkDiff]) {
  box.addEventListener('change', function () {
    showCompare = checkCompare.checked;
    showDiff = checkDiff.checked;
    updateUrl();
    load(selectedSpec);
  });
}

const selectVersion = document.querySelector('#versions');
selectVersion.addEventListener('change', function () {
  selectedVersion = selectVersion.options[selectVersion.selectedIndex].value;
  updateUrl();
  window.location.reload();
});

function updateUrl() {
  const urlSearchParams = new URLSearchParams(window.location.search);
  urlSearchParams.set('spec', selectedSpec ?? '');
  urlSearchParams.set('renderer', selectedRenderer);
  urlSearchParams.set('version', selectedVersion);
  urlSearchParams.set('compare', showCompare ? '1' : '0');
  urlSearchParams.set('diff', showDiff ? '1' : '0');
  window.history.replaceState({}, '', `?${urlSearchParams.toString()}`);
}

async function init() {
  try {
    const data = await fetch('specs-valid.json').then(r => r.json());

    // load manifest of test specifications
    data.forEach(function (name) {
      const opt = document.createElement('option');
      opt.setAttribute('value', name);
      opt.textContent = name;
      selectSpec.appendChild(opt);
    });

    // dev is only served locally, so do not offer it on the hosted page
    if (window.__devAvailable) {
      const devOption = document.createElement('option');
      devOption.value = 'dev';
      devOption.textContent = 'dev';
      selectVersion.appendChild(devOption);
    }

    releaseVersions.forEach(function (name) {
      const opt = document.createElement('option');
      opt.setAttribute('value', name);
      opt.textContent = name;
      selectVersion.appendChild(opt);
    });

    selectedSpec = urlSpec || undefined;
    selectedRenderer = urlRenderer;
    selectedVersion = urlVersion;
    showCompare = urlCompare;
    showDiff = urlDiff;
  } catch (err) {
    console.error(err, err.stack);
  }
}

function syncSelect(select, value) {
  select.selectedIndex = 0;
  for (let i = 0; i < select.options.length; ++i) {
    if (select.options[i].value === value) {
      select.selectedIndex = i;
      break;
    }
  }
}

const panels = document.querySelector('#panels');
const diffPanel = document.querySelector('#diffPanel');
const diffCanvas = document.querySelector('#diffCanvas');
const diffSummary = document.querySelector('#diffSummary');
const bindHost = document.querySelector('#binds');
const overlay = document.querySelector('#overlay');
const wipe = document.querySelector('#wipe');
const setWipe = () => overlay.style.setProperty('--wipe', `${wipe.value}%`);
wipe.addEventListener('input', setWipe);
setWipe();

const thresholdInput = document.querySelector('#diffThreshold');
const thresholdLabel = document.querySelector('#thresholdLabel');
const styleSelect = document.querySelector('#diffStyle');
const styleLabel = document.querySelector('#styleLabel');
const colorInput = document.querySelector('#diffColor');
const colorLabel = document.querySelector('#colorLabel');

function redrawDiff() {
  // the ramp carries its own meaning, so a mark colour would say nothing
  colorLabel.hidden = !showDiff || styleSelect.value === 'heat';
  if (compared.length === 2) {
    refreshDiff(compared[0], compared[1]);
  }
}
for (const control of [thresholdInput, styleSelect, colorInput]) {
  control.addEventListener('input', redrawDiff);
}

function disposeAll() {
  if (view) {
    view.finalize().container().innerHTML = '';
    view = null;
  }
  compared.forEach(v => (v.finalize().container().innerHTML = ''));
  compared = [];
}

/**
 * `watchPixelRatio` is vega's own zoom watcher, which only acts on a canvas
 * renderer. The webgpu one has its own, so both views follow a zoom and stay
 * the same size.
 */
async function buildView(spec, container, renderer, bindEl) {
  const v = new vega.View(vega.parse(spec), {
    logLevel: vega.Warn,
    container,
    bind: bindEl,
    renderer,
    hover: true,
    watchPixelRatio: true,
  });
  await v.runAsync();
  return v;
}

async function load(name) {
  syncSelect(selectVersion, selectedVersion);
  checkCompare.checked = showCompare;
  checkDiff.checked = showDiff;
  disposeAll();
  bindHost.innerHTML = '';

  // compare and diff both need the pair, compare shows it, diff shows only the
  // pixels they disagree on
  const pair = showCompare || showDiff;
  document.querySelector('#vis').hidden = pair;
  panels.hidden = !pair;
  diffPanel.hidden = !showDiff;
  thresholdLabel.hidden = !showDiff;
  styleLabel.hidden = !showDiff;
  colorLabel.hidden = !showDiff || styleSelect.value === 'heat';
  // diff still renders both, out of the way, so the comparison stays live
  panels.style.position = showCompare ? '' : 'absolute';
  panels.style.visibility = showCompare ? '' : 'hidden';
  panels.style.pointerEvents = showCompare ? '' : 'none';
  bindHost.hidden = !pair;

  if (!name || name === 'undefined') {
    return;
  }

  syncSelect(selectSpec, name);
  syncSelect(selectRenderer, selectedRenderer);

  // load vega spec, then visualize it
  try {
    const spec = await fetch(`specs-valid/${name}.vg.json`).then(r => r.json());
    console.log('LOAD', name);

    if (!pair) {
      view = new vega.View(vega.parse(spec), {
        logLevel: vega.Warn,
        container: document.querySelector('#vis'),
        renderer: selectedRenderer,
        hover: true,
        watchPixelRatio: true,
      });
      configureWebGPU();
      window.view = view;
      view.runAsync();
    } else {
      // the canvas view's own controls go to a bin, the webgpu view's are the
      // ones on the page, and its signals drive both
      const bin = document.createElement('div');
      bin.hidden = true;
      const a = await buildView(spec, document.querySelector('#visA'), 'canvas', bin);
      const b = await buildView(spec, document.querySelector('#visB'), 'webgpu', bindHost);
      compared = [a, b];
      window.__compared = compared;
      window.view = b;
      window.watchRenderer?.(b._renderer);
      shareBindings(spec, a, b);
      // the stacked layers need something opaque to cover each other with
      const bg = b.background();
      overlay.style.setProperty('--vis-bg', !bg || bg === 'transparent' || bg === 'none' ? '#fff' : bg);
      if (showDiff) {
        watchForDiff(a, b);
        await refreshDiff(a, b);
      }
    }
    console.log('INIT', name);
  } catch (err) {
    console.error(err, err.stack);
  }
}

/**
 * The webgpu view's bound inputs are the ones on the page, and every signal the
 * spec binds is mirrored onto the canvas view. Two sets of controls let a
 * slider move one view and leave the other behind, so the diff compared two
 * different states.
 */
function shareBindings(spec, a, b) {
  for (const signal of spec.signals ?? []) {
    if (!signal.bind || !signal.name) {
      continue;
    }
    b.addSignalListener(signal.name, (_, value) => {
      if (a.signal(signal.name) !== value) {
        a.signal(signal.name, value).runAsync();
      }
    });
  }
}

/**
 * Redraws the diff shortly after either view does, so hover, drag and zoom stay
 * comparable. `_render` rather than `renderAsync`, because a zoom redraw and a
 * settling frame go straight there, and a ResizeObserver on top of that, since
 * a canvas can change size without either view rendering.
 */
function watchForDiff(a, b) {
  let pending = null;
  const bump = () => {
    clearTimeout(pending);
    pending = setTimeout(() => refreshDiff(a, b), 80);
  };
  for (const v of [a, b]) {
    const r = v._renderer;
    const inner = r._render.bind(r);
    r._render = function (...args) {
      const out = inner(...args);
      bump();
      return out;
    };
  }
  const observer = new ResizeObserver(bump);
  for (const v of [a, b]) {
    const canvas = v.container().querySelector('canvas');
    if (canvas) {
      observer.observe(canvas);
    }
  }
}

/** The chosen mark colour as r, g, b. */
function markColor() {
  const hex = colorInput.value.replace('#', '');
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) || 0);
}

/** Green through yellow to red, for `t` in 0 to 1. */
function ramp(t) {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? [Math.round(2 * x * 255), 200, 40] : [230, Math.round(200 * (1 - (x - 0.5) * 2)), 40];
}

/** Pixels of `el` composited over white, at whatever size the element is. */
function readCanvas(el) {
  const scratch = document.createElement('canvas');
  scratch.width = el.width;
  scratch.height = el.height;
  const c2d = scratch.getContext('2d', { willReadFrequently: true });
  c2d.fillStyle = 'white';
  c2d.fillRect(0, 0, scratch.width, scratch.height);
  c2d.drawImage(el, 0, 0);
  return c2d.getImageData(0, 0, scratch.width, scratch.height);
}

async function readWebgpu(v) {
  const r = v._renderer;
  const shot = await r.captureFrame();
  const out = new ImageData(shot.width, shot.height);
  for (let i = 0; i < shot.data.length; i += 4) {
    const alpha = shot.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      out.data[i + c] = Math.round(shot.data[i + c] * alpha + 255 * (1 - alpha));
    }
    out.data[i + 3] = 255;
  }
  return out;
}

/** Paints only the pixels the two renderers disagree on, darkest where worst. */
async function refreshDiff(a, b) {
  try {
    const left = readCanvas(a.container().querySelector('canvas'));
    const right = await readWebgpu(b);
    if (left.width !== right.width || left.height !== right.height) {
      diffSummary.textContent = `size mismatch: canvas ${left.width}x${left.height}, webgpu ${right.width}x${right.height}`;
      return;
    }
    diffCanvas.width = left.width;
    diffCanvas.height = left.height;
    // Most of what the two renderers disagree on is a level or two of rounding,
    // which painted the whole chart red and read as far worse than it is.
    const threshold = Math.max(0, Number(thresholdInput.value) || 0);
    const style = styleSelect.value;
    const [markR, markG, markB] = markColor();
    const out = new ImageData(left.width, left.height);
    // over lays the marks on the webgpu render, so a difference is placed
    // against what was actually drawn rather than against nothing
    if (style === 'over') {
      out.data.set(right.data);
    }
    // the magnitudes come first, so the ramp can span what is actually there
    const delta = new Uint8Array(left.data.length / 4);
    let differing = 0;
    let shown = 0;
    let worst = 0;
    for (let i = 0, p = 0; i < left.data.length; i += 4, p++) {
      let d = 0;
      for (let c = 0; c < 3; c++) {
        d = Math.max(d, Math.abs(left.data[i + c] - right.data[i + c]));
      }
      delta[p] = d;
      if (d > worst) worst = d;
      if (d > 0) differing++;
      if (d > threshold) shown++;
    }

    const span = Math.max(worst - threshold, 1);
    for (let i = 0, p = 0; i < left.data.length; i += 4, p++) {
      const d = delta[p];
      if (d <= threshold) {
        continue;
      }
      if (style === 'heat') {
        // green at the threshold through to red at the worst pixel here, so
        // the ramp says how bad this comparison is rather than how bad a
        // comparison could be
        const [r, g, b] = ramp((d - threshold) / span);
        out.data[i] = r;
        out.data[i + 1] = g;
        out.data[i + 2] = b;
        out.data[i + 3] = 255;
      } else if (style === 'over') {
        out.data[i] = markR;
        out.data[i + 1] = markG;
        out.data[i + 2] = markB;
        out.data[i + 3] = 255;
      } else {
        out.data[i] = markR;
        out.data[i + 1] = markG;
        out.data[i + 2] = markB;
        out.data[i + 3] = Math.min(255, 60 + d * 3);
      }
    }
    diffCanvas.getContext('2d').putImageData(out, 0, 0);
    const total = left.width * left.height;
    const scale = style === 'heat' ? `, green ${threshold} to red ${worst}` : '';
    diffSummary.textContent =
      `${shown.toLocaleString()} pixels differ by more than ${threshold} ` +
      `(${((100 * shown) / total).toFixed(3)}%), ${differing.toLocaleString()} differ at all, ` +
      `worst channel ${worst}${scale}`;
  } catch (err) {
    diffSummary.textContent = String(err);
  }
}

function configureWebGPU() {
  // count renders rather than animation frames, see fps.js
  window.watchRenderer?.(view?._renderer);
  if (selectedRenderer !== 'webgpu' || !view._renderer) {
    return;
  }

  if (matchesVersion(selectedVersion, '1.0.x', false)) {
    view._renderer.debugLog = false;
  }
  if (matchesVersion(selectedVersion, '1+.1+.x')) {
    view._renderer.wgOptions.debugLog = true;
  }
  if (matchesVersion(selectedVersion, '1+.1+.1+')) {
    view._renderer.wgOptions.renderLock = true;
  }
}

function matchesVersion(version, pattern, devAlwaysTrue = true) {
  if (!version) return false;
  if (version === 'dev') return devAlwaysTrue;

  const versionParts = version.replaceAll('_', '.').split('.');
  const patternParts = pattern.replaceAll('_', '.').split('.');
  if (versionParts.length < patternParts.length) return false;

  for (let i = 0; i < versionParts.length; i++) {
    if (patternParts.length <= i) {
      return true;
    }
    if (patternParts[i].endsWith('+')) {
      const patternNumber = parseInt(patternParts[i].slice(0, -1), 10);
      const versionNumber = parseInt(versionParts[i], 10);
      if (isNaN(patternNumber) || isNaN(versionNumber) || versionNumber < patternNumber) {
        return false;
      } else if (versionNumber > patternNumber) {
        return true;
      }
    } else if (patternParts[i] !== 'x' && versionParts[i] !== patternParts[i]) {
      return false;
    }
  }

  return true;
}

(async () => {
  await init();
  updateUrl();
  await load(selectedSpec);
})();
