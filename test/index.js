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

/**
 * The specs, as a filterable list rather than a dropdown. There are over a
 * hundred of them and the gallery lists them the same way, so the two pages
 * pick a spec by the same means.
 */
const specList = document.querySelector('#specList');
const specFilter = document.querySelector('#specFilter');
let specNames = [];

function drawSpecs() {
  const q = specFilter.value.trim().toLowerCase();
  specList.innerHTML = '';
  for (const name of specNames.filter(n => !q || n.toLowerCase().includes(q))) {
    const el = document.createElement('div');
    el.className = 'case';
    el.dataset.spec = name;
    el.textContent = name;
    el.setAttribute('aria-selected', String(name === selectedSpec));
    el.addEventListener('click', () => {
      selectedSpec = name;
      updateUrl();
      drawSpecs();
      el.scrollIntoView({ block: 'nearest' });
      load(selectedSpec);
    });
    specList.append(el);
  }
}
specFilter.addEventListener('input', drawSpecs);

/** Same keys as the gallery: up and down walk, ctrl with them scrolls. */
RenderCompare.bindListKeys({
  list: specList,
  keyOf: row => row.dataset.spec,
  current: () => selectedSpec,
  pick: name => {
    selectedSpec = name;
    updateUrl();
    drawSpecs();
    specList.querySelector('.case[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    load(selectedSpec);
  },
});

const selectRenderer = document.querySelector('#render');
selectRenderer.addEventListener('change', function () {
  selectedRenderer = selectRenderer.options[selectRenderer.selectedIndex].value;
  updateUrl();
  if (view) {
    // vega builds a fresh renderer here, starting from the defaults rather
    // than the options this page applied to the last one
    view.renderer(selectedRenderer);
    applyOffscreen(view);
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

    specNames = data;
    drawSpecs();

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
const selectDrive = document.querySelector('#drive');
const driveLabel = document.querySelector('#driveLabel');
const overlay = document.querySelector('#overlay');
const wipe = document.querySelector('#wipe');
const wipeReadout = document.querySelector('#wipeReadout');
/**
 * The slider is where the divider sits, so its ends are not "all canvas" and
 * "all webgpu" the way two labels either side of it would suggest. The readout
 * says which renderer has how much, and the corner captions on the render say
 * which side each one is.
 */
const setWipe = () => {
  const at = Number(wipe.value);
  overlay.style.setProperty('--wipe', `${at}%`);
  wipeReadout.textContent = at === 0 ? 'all webgpu' : at === 100 ? 'all canvas' : `canvas ${Math.round(at)}%`;
};
wipe.addEventListener('input', setWipe);
setWipe();

const wipeControls = document.querySelector('#wipeControls');
const blinkBox = document.querySelector('#blinkBox');
const blinkRate = document.querySelector('#blinkRate');
const setBlinkRate = () => overlay.style.setProperty('--blink', blinkRate.value);
blinkRate.addEventListener('change', setBlinkRate);
// A stated preference for less motion picks the slowest rate rather than
// overriding one, since blink is asked for and its speed is now a control.
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
  blinkRate.value = '4s';
}
setBlinkRate();

const viewModes = document.querySelector('#viewModes');
let viewMode = 'wipe';
/**
 * wipe, blink and side by side are three ways of reading the same two layers,
 * so switching between them is a class rather than a rebuild. The wipe controls
 * keep their slot in the row when another mode is on, or the buttons move under
 * the pointer every time the mode changes.
 */
const setViewMode = () => {
  overlay.classList.toggle('blink', viewMode === 'blink');
  overlay.classList.toggle('side', viewMode === 'side');
  wipeControls.classList.toggle('idle', viewMode !== 'wipe');
  blinkBox.classList.toggle('idle', viewMode !== 'blink');
  for (const b of viewModes.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === viewMode));
  }
};
viewModes.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) {
    return;
  }
  viewMode = b.dataset.view;
  setViewMode();
});
setViewMode();

const actualSize = document.querySelector('#actualSize');
actualSize.addEventListener('change', () =>
  document.querySelector('#stage').classList.toggle('actual', actualSize.checked),
);

const bindPanel = document.querySelector('#bindPanel');
/** vega fills the host as it builds, so this is only true once a view exists. */
const syncBindPanel = () => {
  bindPanel.hidden = bindHost.hidden || bindHost.children.length === 0;
};

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

/**
 * Which load is the live one. Every control starts a load and a load awaits
 * twice, so a quick second click ran the first one's tail against the second
 * one's state: `disposeAll` clears `view` at the top and the next statement
 * that reads it is past an await, which threw on a null view. Each run checks
 * it is still the current one after every await and gives up if it is not.
 */
let loadRun = 0;

/** Finalizes views a superseded load had already built. */
function dropViews(...views) {
  for (const v of views) {
    if (v) {
      v.finalize().container().innerHTML = '';
    }
  }
}

/**
 * Holds a view still without tearing it down, so the other one can be watched
 * at its own speed.
 *
 * Two views on one page take turns on one thread and vega's timers all fire in
 * one animation frame, so the pair advances in lockstep and the slower one sets
 * the pace: on the benchmark at forty thousand symbols both read 8 renders a
 * second, and holding the canvas one still takes the webgpu one to 31.
 */
function holdView(v, held) {
  if (!v) {
    return;
  }
  if (held && !v.__held) {
    v.__held = { run: v.run, runAsync: v.runAsync };
    v.run = function () {
      return this;
    };
    v.runAsync = function () {
      return Promise.resolve(this);
    };
  } else if (!held && v.__held) {
    v.run = v.__held.run;
    v.runAsync = v.__held.runAsync;
    delete v.__held;
  }
}

/** Applies the run control to the compared pair. */
function applyDrive() {
  const mode = selectDrive?.value ?? 'both';
  const [a, b] = compared;
  holdView(a, mode === 'webgpu');
  holdView(b, mode === 'canvas');
  window.resetRendererCounts?.();
}

selectDrive?.addEventListener('change', applyDrive);

function disposeAll() {
  window.resetRenderers?.();
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
/**
 * `offscreen=1` renders into a texture instead of the canvas swapchain.
 * Acquiring the swapchain destroys the device on a runner with no compositor,
 * so this is what lets CI drive this page at all. What is drawn is unchanged
 * and still reachable through captureFrame, the canvas just stays blank.
 */
function applyOffscreen(v) {
  if (new URLSearchParams(window.location.search).get('offscreen') !== '1') {
    return;
  }
  const options = v?._renderer?.wgOptions;
  if (options) {
    options.offscreen = true;
  }
}

async function buildView(spec, container, renderer, bindEl) {
  const v = new vega.View(vega.parse(spec), {
    logLevel: vega.Warn,
    container,
    bind: bindEl,
    renderer,
    hover: true,
    watchPixelRatio: true,
  });
  applyOffscreen(v);
  await v.runAsync();
  return v;
}

async function load(name) {
  const run = ++loadRun;
  const live = () => run === loadRun;
  syncSelect(selectVersion, selectedVersion);
  checkCompare.checked = showCompare;
  checkDiff.checked = showDiff;
  disposeAll();
  bindHost.innerHTML = '';

  // compare and diff both need the pair, compare shows it, diff shows only the
  // pixels they disagree on
  const pair = showCompare || showDiff;
  // the stage, not the div inside it, or its padding and checkerboard stay
  document.querySelector('#visStage').hidden = pair;
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
  driveLabel.hidden = !pair;
  syncBindPanel();

  if (!name || name === 'undefined') {
    return;
  }

  drawSpecs();
  syncSelect(selectRenderer, selectedRenderer);

  // load vega spec, then visualize it
  try {
    const spec = await fetch(`specs-valid/${name}.vg.json`).then(r => r.json());
    if (!live()) {
      return;
    }
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
      applyOffscreen(view);
      window.view = view;
      await view.runAsync();
      if (!live()) {
        return; // a newer load has already disposed this one
      }
      // the same opaque ground the compared pair gets, see #visSolo
      const solo = view.background();
      document
        .querySelector('#visSolo')
        .style.setProperty('--vis-bg', !solo || solo === 'transparent' || solo === 'none' ? '#fff' : solo);
    } else {
      // the canvas view's own controls go to a bin, the webgpu view's are the
      // ones on the page, and its signals drive both
      const bin = document.createElement('div');
      bin.hidden = true;
      const a = await buildView(spec, document.querySelector('#visA'), 'canvas', bin);
      if (!live()) {
        dropViews(a);
        return;
      }
      const b = await buildView(spec, document.querySelector('#visB'), 'webgpu', bindHost);
      if (!live()) {
        dropViews(a, b);
        return;
      }
      compared = [a, b];
      applyDrive();
      window.__compared = compared;
      window.view = b;
      // both, so the two cpu and gpu columns stand next to each other
      window.watchRenderer?.(a._renderer, 'canvas');
      window.watchRenderer?.(b._renderer, 'webgpu');
      shareBindings(spec, a, b);
      syncBindPanel();
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
    // Reading the webgpu frame draws it, and that draw arrives here like any
    // other. Without this the diff asks for a capture, the capture renders, the
    // render asks for a diff, and the numbers never stop moving.
    if (capturing) {
      return;
    }
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

/** True while a capture is in flight, since a capture renders what it captures. */
let capturing = false;

/** Paints only the pixels the two renderers disagree on, darkest where worst. */
async function refreshDiff(a, b) {
  try {
    const left = RenderCompare.readCanvas(a.container().querySelector('canvas'));
    capturing = true;
    let right;
    try {
      right = await RenderCompare.readRenderer(b);
    } finally {
      capturing = false;
    }
    const out = RenderCompare.diffImages(left, right, {
      threshold: Number(thresholdInput.value) || 0,
      style: styleSelect.value,
      color: colorInput.value,
    });
    if (out.error) {
      diffSummary.textContent = out.error;
      return;
    }
    diffCanvas.width = out.width;
    diffCanvas.height = out.height;
    diffCanvas.getContext('2d').putImageData(out.image, 0, 0);
    diffSummary.textContent = out.summary;
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
