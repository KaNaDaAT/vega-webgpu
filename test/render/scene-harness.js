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

    const dir = params.get('dir') === 'hostile' ? 'scenes-hostile' : 'scenes';
    const fixture = await window.SceneFixture.load('./', name, dir);
    const r = await window.SceneFixture.render(fixture, rendererName, document.querySelector('#vis'), renderer => {
      applyTestOptions(renderer, params);
      window.renderer = renderer;
    });

    const kind = rendererKind(r);
    window.__rendererKind = kind;
    installSnapshot(r, kind);
    window.__renderDone = true;
  } catch (err) {
    console.error(err);
    window.__renderError = String((err && err.stack) || err);
  }
})();
