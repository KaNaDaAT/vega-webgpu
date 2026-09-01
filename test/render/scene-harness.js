/**
 * Renders one scenegraph fixture from test/render/scenes with the requested
 * renderer, driving the renderer directly instead of through a View. Nothing
 * between the fixture and the mark code, so a failure is the renderer's.
 * Driven by test/render/scene.spec.ts.
 */
(async () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const name = params.get('scene');
    const rendererName = params.get('renderer') || 'webgpu';
    if (!name) {
      throw new Error('Missing ?scene= parameter.');
    }

    const fixture = await fetch(`./scenes/${name}.json`).then(r => {
      if (!r.ok) throw new Error(`Failed to load scene '${name}': ${r.status}`);
      return r.json();
    });

    const module = vega.renderModule(rendererName);
    if (!module?.renderer) {
      throw new Error(`No renderer registered for '${rendererName}'.`);
    }

    const scene = vega.sceneFromJSON(JSON.stringify(fixture.scene));
    const r = new module.renderer();
    applyTestOptions(r, params);
    r.initialize(document.querySelector('#vis'), fixture.width, fixture.height, fixture.origin ?? [0, 0]);
    r.background(fixture.background ?? '#ffffff');
    window.renderer = r;

    await r.renderAsync(scene);

    const kind = rendererKind(r);
    window.__rendererKind = kind;
    installSnapshot(r, kind);
    window.__renderDone = true;
  } catch (err) {
    console.error(err);
    window.__renderError = String((err && err.stack) || err);
  }
})();
