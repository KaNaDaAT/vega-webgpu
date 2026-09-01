/**
 * Renders one spec from test/specs-valid with the requested renderer and
 * signals completion through window.__renderDone / window.__renderError.
 * Also reports which renderer actually ran (window.__rendererKind) so the
 * test can assert the intended renderer was used and did not silently fall
 * back. Driven by test/render/render.spec.ts.
 */
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

    // vega builds the renderer during construction, so options can be set
    // before the first frame.
    applyTestOptions(view._renderer, params);

    // vega catches renderer errors and routes them through its logger, so they
    // never reach window.onerror. Record them with a stack.
    const viewError = view.error.bind(view);
    view.error = (...args) => {
      window.__traces.push(`view.error: ${args.map(a => (a && a.stack) || String(a)).join(' | ')}`);
      return viewError(...args);
    };

    await view.runAsync();

    const r = view._renderer;
    const kind = rendererKind(r);
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

    installSnapshot(r, kind);
    window.__renderDone = true;
  } catch (err) {
    console.error(err);
    window.__renderError = String((err && err.stack) || err);
  }
})();
