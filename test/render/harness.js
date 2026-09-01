/**
 * Renders one spec from test/specs-valid with the requested renderer and
 * signals completion through window.__renderDone / window.__renderError.
 * Also reports which renderer actually ran (window.__rendererKind) so the
 * test can assert the intended renderer was used and did not silently fall
 * back. Driven by test/render/render.spec.ts.
 */
// Errors vega catches and logs carry no stack by the time they reach the
// console, so record them here for the test to report.
window.__traces = [];
const recordTrace = (label, err) => {
  const stack = (err && err.stack) || String(err);
  window.__traces.push(`${label}: ${stack}`);
};
window.addEventListener('error', e => recordTrace('window.onerror', e.error ?? e.message));
window.addEventListener('unhandledrejection', e => recordTrace('unhandledrejection', e.reason));

(async () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const name = params.get('spec');
    const renderer = params.get('renderer') || 'webgpu';
    if (!name) {
      throw new Error('Missing ?spec= parameter.');
    }

    // Same determinism knob as vega's own scene tests.
    vega.setRandom(vega.randomLCG(123456789));

    const spec = await fetch(`../specs-valid/${name}.vg.json`).then(r => {
      if (!r.ok) throw new Error(`Failed to load spec '${name}': ${r.status}`);
      return r.json();
    });

    const view = new vega.View(vega.parse(spec), {
      logLevel: vega.Warn,
      renderer,
      container: '#vis',
      hover: false,
      // spec data urls are relative to test/, not test/render/
      loader: vega.loader({ baseURL: '../' }),
    });
    window.view = view;

    // vega catches renderer errors and routes them through its logger, so they
    // never reach window.onerror. Record them with a stack.
    const viewError = view.error.bind(view);
    view.error = (...args) => {
      window.__traces.push(`view.error: ${args.map(a => (a && a.stack) || String(a)).join(' | ')}`);
      return viewError(...args);
    };

    await view.runAsync();

    const r = view._renderer;
    // Identify the renderer that actually ran by capability, not class name
    // (vega's minified bundle mangles class names). The WebGPU renderer
    // exposes wgOptions + a live device(). The canvas renderer hands out a
    // real 2D context from its canvas.
    let kind = 'none';
    if (r) {
      if (r.wgOptions && typeof r.device === 'function' && r.device()) {
        kind = 'webgpu';
      } else if (typeof r.canvas === 'function' && r.canvas() && r.canvas().getContext('2d')) {
        kind = 'canvas';
      } else {
        kind = r.constructor?.name || 'other';
      }
    }
    window.__rendererKind = kind;

    // Wait for the WebGPU renderer's async GPU submission plus any pending
    // resource loads (images) and the re-render they trigger.
    if (r && r._renderPromise) {
      await r._renderPromise;
      while (r._ready) {
        await r._ready;
        await r._renderPromise;
      }
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // Prefer reading the GPU texture directly: a headless runner never
    // composites, so both element screenshots and toDataURL come back blank
    // there. The canvas renderer has no such path, so it uses toDataURL.
    window.__snapshot = async () => {
      const el = document.querySelector('#vis canvas');
      if (!el) return null;
      if (kind === 'webgpu' && r && typeof r.captureFrame === 'function') {
        let shot;
        try {
          shot = await r.captureFrame();
        } catch (err) {
          // Fall back rather than hang the test. toDataURL is blank without a
          // compositor, which the pixel diff will show, and the reason lands in
          // the failure output instead of a bare timeout.
          recordTrace('captureFrame failed', err);
          return { dataUrl: el.toDataURL('image/png') };
        }
        // base64 rather than a plain array: serializing a few million numbers
        // as JSON across the debugging protocol dwarfs the render itself.
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < shot.data.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, shot.data.subarray(i, i + CHUNK));
        }
        return { rawB64: btoa(binary), width: shot.width, height: shot.height };
      }
      return { dataUrl: el.toDataURL('image/png') };
    };

    window.__renderDone = true;
  } catch (err) {
    console.error(err);
    window.__renderError = String((err && err.stack) || err);
  }
})();
