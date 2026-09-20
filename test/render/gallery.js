/**
 * Browses what a render run produced, and renders the same specs live for
 * comparison. Two sources for the same question, so the two share the viewer:
 * `recorded` reads the pngs in test/render/output, `live` builds both renderers
 * here and now. The measuring and the diff painting come from compare-core.js,
 * which is also what the demo page uses.
 */
const $ = id => document.getElementById(id);

const state = {
  cases: [],
  settings: null,
  hasRecorded: false,
  snapshot: null,
  pick: null,
  view: 'side',
  source: 'recorded',
  /** The two ImageData of whatever is shown, so the diff has something to work on. */
  pixels: null,
};

/**
 * Fitting is an inline style, because a live canvas arrives with one of its own
 * from vega and a class cannot outrank that. Which means actual size has to put
 * the element's own sizing back rather than let a stylesheet do it: for an
 * image that is its natural size, and for a live canvas it is the css size vega
 * set, which is the true 1:1 view at any pixel ratio.
 */
function applyFit(el) {
  if (el.dataset.ownWidth === undefined) {
    el.dataset.ownWidth = el.style.width;
    el.dataset.ownHeight = el.style.height;
  }
  const actual = $('actualSize').checked;
  el.style.width = actual ? el.dataset.ownWidth : '100%';
  el.style.height = actual ? el.dataset.ownHeight : 'auto';
}

/* ---------------------------------------------------------------- sidebar */

function drawList() {
  const q = $('filter').value.trim().toLowerCase();
  const key = $('sort').value;
  const rows = state.cases
    .filter(c => !q || c.name.toLowerCase().includes(q))
    .sort((a, b) => (key === 'name' ? a.name.localeCompare(b.name) : (b[key] ?? 0) - (a[key] ?? 0)));

  $('list').innerHTML = '';
  for (const c of rows) {
    const el = document.createElement('div');
    el.className = 'case';
    el.dataset.file = c.file;
    el.setAttribute('aria-selected', String(c.file === state.pick?.file));
    el.innerHTML = '<span class="name"></span><span class="kind"></span><span class="meta"></span>';
    el.querySelector('.name').textContent = c.name;
    el.querySelector('.kind').textContent = c.skip ? skipTag(c.skip) : c.kind;
    if (c.skip) {
      el.classList.add('skipped');
      el.querySelector('.kind').title = c.skip.summary;
    }
    if (state.hasRecorded) {
      const flat = c.flatSample >= 1000 ? `flat ${c.flat.toFixed(2)}` : 'flat n/a';
      el.querySelector('.meta').textContent =
        `${(c.diff * 100).toFixed(3)}%  mean ${c.mean.toFixed(2)}  bias ${(c.bias ?? 0).toFixed(2)}  ${flat}  quad ${(c.quad ?? 0).toFixed(1)}`;
    } else {
      el.querySelector('.meta').remove();
    }
    el.addEventListener('click', () => select(c));
    $('list').append(el);
  }
}

function select(c) {
  if (!c) {
    return;
  }
  state.pick = c;
  location.hash = encodeURIComponent(c.file);
  drawList();
  document.querySelector('.case[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  show();
}

/* ------------------------------------------------------------ the sources */

const src = (c, which) => `./output/${c.file}-${which}.png`;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/** The two recorded pngs, as elements to show and pixels to measure. */
async function recordedPair(c) {
  const [canvas, webgpu] = await Promise.all([loadImage(src(c, 'canvas')), loadImage(src(c, 'webgpu'))]);
  return {
    canvasEl: canvas,
    webgpuEl: webgpu,
    read: () => ({ left: RenderCompare.readImage(canvas), right: RenderCompare.readImage(webgpu) }),
  };
}

let vegaReady = null;
const script = url =>
  new Promise(resolve => {
    const el = document.createElement('script');
    el.src = url;
    el.onload = () => resolve(true);
    el.onerror = () => resolve(false);
    document.head.append(el);
  });

/** Loads vega and the dev build once, the same order the playground uses. */
function loadRuntime() {
  vegaReady ??= (async () => {
    const ok =
      (await script('../../node_modules/vega/build/vega.min.js')) ||
      (await script('https://cdn.jsdelivr.net/npm/vega@6.2.0/build/vega.min.js'));
    if (!ok) {
      throw new Error('vega did not load');
    }
    if (!(await script('../../build/vega-webgpu-renderer.js'))) {
      throw new Error('no dev build. Run npm run build');
    }
    if (!window.vega.renderModule('webgpu')) {
      throw new Error('the build loaded but registered no webgpu renderer');
    }
  })();
  return vegaReady;
}

let liveViews = [];
/** Bumped whenever the live views are torn down, so a stale pair can tell. */
let liveToken = 0;

function disposeLive() {
  liveToken++;
  for (const v of liveViews) {
    try {
      v.finalize();
      v._renderer?.finalize?.();
    } catch {
      // a view that never finished building has nothing to release
    }
  }
  liveViews = [];
}

/**
 * The live pair for a fixture, which has no spec to run. The suite draws a
 * fixture by handing the stored scenegraph straight to a renderer, and
 * scene-fixture.js is that same code, so what the gallery shows here is what
 * the suite measured rather than an approximation of it.
 */
async function liveFixturePair(c) {
  const dir = (await fetch(`./scenes/${c.name}.json`, { method: 'HEAD' })).ok ? 'scenes' : 'scenes-hostile';
  const fixture = await window.SceneFixture.load('./', c.name, dir);
  const mine = liveToken;
  const build = async renderer => {
    const host = document.createElement('div');
    const r = await window.SceneFixture.render(fixture, renderer, host);
    // A renderer drawn without a View still has to be released, and the live
    // views list is what disposeLive walks.
    liveViews.push({ finalize: () => {}, _renderer: r });
    return { host, r };
  };
  const canvas = await build('canvas');
  const webgpu = await build('webgpu');
  const canvasEl = canvas.host.querySelector('canvas');
  const webgpuEl = webgpu.host.querySelector('canvas');
  if (!canvasEl || !webgpuEl) {
    throw new Error(
      `${!canvasEl ? 'canvas' : 'webgpu'} drew nothing here. WebGPU needs a browser with an adapter available.`,
    );
  }
  return {
    canvasEl,
    webgpuEl,
    read: async () => {
      if (liveToken !== mine) {
        throw new Error('this pair was replaced before it could be read');
      }
      return {
        left: RenderCompare.readCanvas(canvasEl),
        // readRenderer only reaches through to captureFrame, so a fixture
        // passes the renderer where a spec passes its view.
        right: await RenderCompare.readRenderer({ _renderer: webgpu.r }),
      };
    },
  };
}

/**
 * Renders a spec with both renderers, with no hover and no bound controls: this
 * is for looking at the pixels, and an interaction would only make the two
 * disagree about which frame they are on.
 */
async function livePair(c) {
  await loadRuntime();
  disposeLive();
  if (c.kind === 'fixture') {
    return liveFixturePair(c);
  }
  const spec = await (await fetch(`../specs-valid/${c.name}.vg.json`)).json();

  // The specs load their data from `data/...`, which is relative to test/ and
  // not to this page a directory below it.
  const loader = vega.loader({ baseURL: new URL('../', location.href).href });
  const build = async renderer => {
    const host = document.createElement('div');
    const view = new vega.View(vega.parse(spec), {
      renderer,
      container: host,
      hover: false,
      loader,
      logLevel: vega.Warn,
      // Zoom changes the device pixel ratio without resizing the view, and this
      // is what tells a renderer so. The webgpu renderer redraws on it by
      // default, but nothing asks it to without this, so a zoom left the two
      // sides of the comparison at different ratios.
      watchPixelRatio: true,
    });
    await view.runAsync();
    liveViews.push(view);
    return { host, view };
  };
  const mine = liveToken;
  const canvas = await build('canvas');
  const webgpu = await build('webgpu');
  const canvasEl = canvas.host.querySelector('canvas');
  const webgpuEl = webgpu.host.querySelector('canvas');
  if (!canvasEl || !webgpuEl) {
    throw new Error(
      `${!canvasEl ? 'canvas' : 'webgpu'} drew nothing here. WebGPU needs a browser with an adapter available.`,
    );
  }
  return {
    canvasEl,
    webgpuEl,
    read: async () => {
      // Disposal, not detachment: the diff view never puts these in the page,
      // so whether they are connected says nothing about whether they are live.
      if (liveToken !== mine) {
        throw new Error('this pair was replaced before it could be read');
      }
      return { left: RenderCompare.readCanvas(canvasEl), right: await RenderCompare.readRenderer(webgpu.view) };
    },
  };
}

/* ----------------------------------------------------------- the viewport */

function setNote(html) {
  $('note').hidden = !html;
  $('note').innerHTML = html ?? '';
}

/** Says what produced the numbers, since a number without its settings says little. */
/** One labelled value, so a number is never hunted for inside a sentence. */
const fact = (label, value, title) =>
  `<span class="fact"${title ? ` title="${title}"` : ''}><b>${label}</b>${value}</span>`;

const escapeHtml = text =>
  String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

/** How a skip is labelled wherever it is shown, in the list and on the case. */
const skipTag = skip => (skip.milestone === 'upstream' ? 'not ours' : `todo ${skip.milestone}`);

/**
 * A skipped case is drawn and recorded like any other and gated like none, so
 * without this it reads as a case that passes with a large difference. The
 * banner is the only thing on the page that says the numbers below it are not
 * held to anything.
 */
function skipBanner(c) {
  if (!c.skip) {
    return '';
  }
  const upstream = c.skip.milestone === 'upstream';
  return (
    `<p class="skipped${upstream ? ' upstream' : ''}">` +
    `<b>${escapeHtml(skipTag(c.skip))}</b> not gated. ${escapeHtml(c.skip.reason)}</p>`
  );
}

function recordedNote(c) {
  const s = state.settings;
  const b = c.budgets;
  const facts = [
    fact('source', 'recorded', 'The pngs a test run left behind'),
    fact(
      'differing',
      `${(c.diff * 100).toFixed(3)}%`,
      'Share of the frame pixelmatch calls different, which is what the suite gates on. It ignores anything under a colour threshold, so this reads zero while the next chip counts tens of thousands of pixels a level or two apart',
    ),
    ...(c.touched === undefined
      ? []
      : [
          fact(
            'any difference',
            `${(c.touched * 100).toFixed(2)}%`,
            'Share of the frame where at least one channel differs at all, with no threshold. Above this, zero means nothing passed the gate, not that the two are identical',
          ),
        ]),
    fact('worst tile', `${(c.tile * 100).toFixed(1)}%`, 'Densest 32 pixel square of that difference'),
    fact('mean', c.mean.toFixed(2), 'Average channel error over inked pixels, 0 to 255'),
    fact(
      'bias',
      (c.bias ?? 0).toFixed(2),
      'The same average, signed. A coverage difference pushes pixels both ways and cancels here, so what is left is the render being one-sidedly wrong',
    ),
    fact(
      'flat',
      c.flatSample >= 1000 ? c.flat.toFixed(2) : 'n/a',
      c.flatSample >= 1000
        ? `The same average away from any edge, over ${c.flatSample.toLocaleString()} pixels`
        : 'Too few flat pixels here to measure over',
    ),
    fact(
      'worst block',
      (c.quad ?? 0).toFixed(1),
      'The furthest-off 2 scene pixel block average, which a moved edge does not shift',
    ),
  ];
  if (b) {
    const budget =
      `${b.diff === null ? 'count skipped' : `${(b.diff * 100).toFixed(1)}%`} / tile ${(b.tile * 100).toFixed(0)}%` +
      ` / mean ${b.mean}${b.bias === undefined ? '' : ` / bias ${b.bias}`} / flat ${b.flat}` +
      `${b.quad ? ` / block ${b.quad}` : ''}`;
    facts.push(fact('budgets', budget, 'What the suite allows this case before it fails'));
  }
  if (s) {
    facts.push(
      fact(
        'run',
        `dpr ${s.dpr}, ${s.rendererOptions}${s.ci ? ', on CI' : ''}`,
        `pixelmatch threshold ${s.pixelmatchThreshold}${s.includeAA ? ', counting antialiased pixels' : ''},` +
          ` flat window 3x3 within ${s.flatEps} levels`,
      ),
    );
  }
  // a fixture says which mode or shape each part of it is, which is the only
  // place that is written down: putting the names in the picture would add text
  // antialiasing to a test that exists to measure something else
  const what = c.note ? `<p class="what"><b>${c.name}</b> ${c.note}</p>` : '';
  return `${skipBanner(c)}${what}<div class="facts">${facts.join('')}</div>`;
}

/** The live note, in the same shape, since the two are read one after the other. */
function liveNote(c) {
  const facts = [
    fact('source', 'live', 'Rendered here and now by both renderers'),
    fact('drawn', 'no hover, no bound controls', 'An interaction would leave the two on different frames'),
    fact('at', `dpr ${window.devicePixelRatio}`, "This browser's own pixel ratio and adapter, not the run's"),
  ];
  if (!state.hasRecorded) {
    facts.push(fact('recorded', 'none yet', 'Run npm run gallery:record for the stored pairs and their numbers'));
  }
  // A skip is not gated whichever way it is being looked at.
  return `${c ? skipBanner(c) : ''}<div class="facts">${facts.join('')}</div>`;
}

function applyView() {
  const stage = $('stage');
  stage.classList.toggle('side', state.view === 'side');
  $('wipeBox').classList.toggle('idle', state.view !== 'wipe');
  $('blinkBox').classList.toggle('idle', state.view !== 'blink');
  $('diffOpts').classList.toggle('idle', state.view !== 'diff');
  for (const b of $('viewModes').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  }
}

const setWipe = () => {
  const at = Number($('wipe').value);
  document.querySelector('.overlay')?.style.setProperty('--wipe', `${at}%`);
  $('wipeReadout').textContent = at === 0 ? 'all webgpu' : at === 100 ? 'all canvas' : `canvas ${Math.round(at)}%`;
};

/** Puts the pair on the stage in whatever shape the current view calls for. */
function paint(pair) {
  const stage = $('stage');
  stage.innerHTML = '';
  const a = pair.canvasEl;
  const b = pair.webgpuEl;
  for (const el of [a, b]) {
    applyFit(el);
  }

  if (state.view === 'side') {
    const mk = (el, caption) => {
      const fig = document.createElement('figure');
      fig.className = 'pane';
      const cap = document.createElement('figcaption');
      cap.textContent = caption;
      fig.append(cap, el);
      return fig;
    };
    const row = document.createElement('div');
    row.className = 'sideBySide';
    row.append(mk(a, 'canvas'), mk(b, 'webgpu'));
    stage.append(row);
    return;
  }

  if (state.view === 'diff') {
    const fig = document.createElement('figure');
    fig.className = 'pane';
    const cap = document.createElement('figcaption');
    cap.id = 'diffSummary';
    const c = document.createElement('canvas');
    c.id = 'diffCanvas';
    c.style.background = '#fff';
    fig.append(cap, c);
    stage.append(fig);
    void refreshDiff(pair);
    return;
  }

  // wipe and blink stack the two, so the eye compares in one place. Each layer
  // carries its own label, which is what lets blink name what is on screen.
  const overlay = document.createElement('div');
  overlay.className = `overlay${state.view === 'blink' ? ' blink' : ''}`;
  overlay.style.setProperty('--blink', $('blinkRate').value);
  const layer = (el, name, cls) => {
    const div = document.createElement('div');
    div.className = cls;
    const tag = document.createElement('span');
    tag.className = 'side';
    tag.textContent = name;
    div.append(tag, el);
    return div;
  };
  overlay.append(layer(a, 'canvas', 'layer'), layer(b, 'webgpu', 'layer top'));
  stage.append(overlay);
  setWipe();
}

async function refreshDiff(pair) {
  const summary = $('diffSummary');
  const canvas = $('diffCanvas');
  if (!summary || !canvas) {
    return;
  }
  try {
    const { left, right } = await pair.read();
    const out = RenderCompare.diffImages(left, right, {
      threshold: Number($('diffThreshold').value) || 0,
      style: $('diffStyle').value,
      scope: $('diffScope').value,
      color: $('diffColor').value,
    });
    if (out.error) {
      summary.textContent = out.error;
      return;
    }
    canvas.width = out.width;
    canvas.height = out.height;
    applyFit(canvas);
    canvas.getContext('2d').putImageData(out.image, 0, 0);
    summary.textContent = out.summary;
  } catch (err) {
    summary.textContent = String(err);
  }
}

let current = null;

/**
 * Bumped on every show, so a slow one that has been overtaken stops rather than
 * painting over the newer pick. Building a live pair takes long enough to click
 * twice, and the second build disposes the first's views underneath it.
 */
let generation = 0;

async function show() {
  const c = state.pick;
  if (!c) {
    return;
  }
  const mine = ++generation;
  $('title').textContent = `${c.name}${c.width ? `  ${c.width}x${c.height}` : ''}  (${state.source})`;
  applyView();
  try {
    const pair = state.source === 'live' ? await livePair(c) : await recordedPair(c);
    if (mine !== generation) {
      return;
    }
    current = pair;
    setNote(state.source === 'live' ? liveNote(c) : recordedNote(c));
    paint(current);
  } catch (err) {
    if (mine !== generation) {
      return;
    }
    current = null;
    $('stage').innerHTML = '';
    setNote(`<b>could not show this</b> ${String(err.message ?? err)}`);
  }
}

/* -------------------------------------------------------------- the wiring */

$('viewModes').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) {
    return;
  }
  state.view = b.dataset.view;
  applyView();
  if (current) {
    paint(current);
  }
});

$('source').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.dataset.source === state.source) {
    return;
  }
  state.source = b.dataset.source;
  for (const o of $('source').querySelectorAll('button')) {
    o.setAttribute('aria-pressed', String(o.dataset.source === state.source));
  }
  if (state.source !== 'live') {
    disposeLive();
  }
  void show();
});

$('wipe').addEventListener('input', setWipe);
// A stated preference for less motion picks the slowest rate rather than
// overriding one, since blink is asked for and its speed is a control.
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
  $('blinkRate').value = '4s';
}
$('blinkRate').addEventListener('change', () =>
  document.querySelector('.overlay')?.style.setProperty('--blink', $('blinkRate').value),
);
for (const id of ['diffThreshold', 'diffStyle', 'diffScope', 'diffColor']) {
  $(id).addEventListener('input', () => {
    if (state.view === 'diff' && current) {
      void refreshDiff(current);
    }
  });
}
$('actualSize').addEventListener('change', () => {
  $('stage').classList.toggle('actual', $('actualSize').checked);
  for (const el of $('stage').querySelectorAll('canvas, img')) {
    applyFit(el);
  }
});
$('infoBtn').addEventListener('click', () => $('infoDialog').showModal());
$('filter').addEventListener('input', drawList);
$('sort').addEventListener('change', drawList);

addEventListener('hashchange', () => {
  const want = decodeURIComponent(location.hash.slice(1));
  const c = state.cases.find(x => x.file === want);
  if (c && c.file !== state.pick?.file) {
    select(c);
  }
});

RenderCompare.bindListKeys({
  list: $('list'),
  keyOf: row => row.dataset.file,
  current: () => state.pick?.file,
  pick: file => select(state.cases.find(c => c.file === file)),
});

/**
 * Recorded cases come from a run, live ones do not. With no run on disk the
 * page still works: the spec list the demo page uses stands in, every case is
 * live only, and the recorded button says why it is off. A run adds the
 * measurements and the stored pngs on top.
 */
async function loadCases() {
  try {
    const res = await fetch('./output/index.json');
    if (res.ok) {
      const manifest = await res.json();
      return {
        cases: manifest.cases,
        settings: manifest.settings ?? null,
        recorded: true,
        snapshot: manifest.snapshot ?? null,
      };
    }
  } catch {
    // no run on disk, which is not an error
  }
  const names = await (await fetch('../specs-valid.json')).json();
  const blank = { kind: 'spec', width: 0, height: 0, diff: 0, tile: 0, mean: 0, flat: 0, flatSample: 0, quad: 0 };
  return {
    cases: names.map(name => ({ ...blank, name, file: name, recorded: false })),
    settings: null,
    recorded: false,
  };
}

loadCases().then(({ cases, settings, recorded, snapshot }) => {
  state.cases = cases;
  state.settings = settings;
  state.hasRecorded = recorded;
  state.snapshot = snapshot ?? null;
  if (state.snapshot) {
    // a published snapshot is the pngs and nothing else: no dev build to load
    // and no spec to run, so there is nothing for live mode to render
    const btn = $('source').querySelector('[data-source="live"]');
    btn.disabled = true;
    btn.title = 'Rendering here needs the repository checked out. This page is a published snapshot.';
  }
  if (!recorded) {
    state.source = 'live';
    const btn = $('source').querySelector('[data-source="recorded"]');
    btn.disabled = true;
    btn.title = 'Nothing recorded yet. Run npm run gallery:record';
    for (const o of $('source').querySelectorAll('button')) {
      o.setAttribute('aria-pressed', String(o.dataset.source === 'live'));
    }
    $('sort').hidden = true;
  }
  const want = decodeURIComponent(location.hash.slice(1));
  state.pick = state.cases.find(c => c.file === want) ?? state.cases[0];
  drawList();
  void show();
});
