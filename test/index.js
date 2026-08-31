const urlParams = new URLSearchParams(window.location.search);
const urlSpec = urlParams.get('spec');
const urlRenderer = urlParams.get('renderer') ?? 'webgpu';
const urlVersion = window.__rendererVersion ?? urlParams.get('version') ?? 'dev';

const releaseVersions = typeof vegaWebGPURendererVersions !== 'undefined' ? vegaWebGPURendererVersions : [];

let view, selectedSpec, selectedRenderer, selectedVersion;

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

async function load(name) {
  syncSelect(selectVersion, selectedVersion);
  if (view) view.finalize().container().innerHTML = '';
  if (!name || name === 'undefined') {
    return;
  }

  syncSelect(selectSpec, name);
  syncSelect(selectRenderer, selectedRenderer);

  // load vega spec, then visualize it
  try {
    const spec = await fetch(`specs-valid/${name}.vg.json`).then(r => r.json());
    console.log('LOAD', name);

    view = new vega.View(vega.parse(spec))
      .logLevel(vega.Warn)
      .initialize(document.querySelector('#vis'))
      .renderer(selectedRenderer)
      .hover();
    configureWebGPU();

    view.runAsync();
    console.log('INIT', name);
  } catch (err) {
    console.error(err, err.stack);
  }
}

function configureWebGPU() {
  if (selectedRenderer !== 'webgpu' || !view._renderer) {
    return;
  }

  if (matchesVersion(selectedVersion, '1.0.x', false)) {
    view._renderer.debugLog = false;
    view._renderer.simpleLine = true;
  }
  if (matchesVersion(selectedVersion, '1+.1+.x')) {
    view._renderer.wgOptions.debugLog = true;
  }
  if (matchesVersion(selectedVersion, '1+.1+.1+')) {
    view._renderer.wgOptions.renderLock = true;
  }
  if (matchesVersion(selectedVersion, '1+.2+.x')) {
    view._renderer.wgOptions.renderBatch = true;
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
