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
    const fixture = await fetch(`./${dir}/${name}.json`).then(r => {
      if (!r.ok) throw new Error(`Failed to load scene '${name}': ${r.status}`);
      return r.json();
    });

    const module = vega.renderModule(rendererName);
    if (!module?.renderer) {
      throw new Error(`No renderer registered for '${rendererName}'.`);
    }

    // JSON has no literal for NaN or Infinity, so hostile fixtures carry them
    // as sentinels.
    const revive = (_key, value) =>
      value === '__NaN__' ? NaN : value === '__Infinity__' ? Infinity : value === '__-Infinity__' ? -Infinity : value;
    const scene = vega.sceneFromJSON(JSON.parse(JSON.stringify(fixture.scene), revive));
    boundScene(scene);
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

/**
 * Fills in item bounds, which a serialized fixture does not carry and a
 * gradient needs to map its ramp onto. A live scenegraph gets these from
 * vega's Bound transform, which allocates one per item before measuring.
 */
function boundScene(node) {
  if (!node || typeof node !== 'object') return;
  for (const item of node.items ?? []) {
    item.bounds = item.bounds ?? new vega.Bounds();
    for (const child of item.items ?? []) {
      if (child && child.marktype) boundScene(child);
    }
  }
  if (!node.marktype) return;
  vega.boundMark(node);
  // A nested mark draws its whole series from items[0], and the gradient on it
  // reads that item's bounds, which boundMark leaves empty.
  if (vega.Marks[node.marktype]?.nested && node.items?.length) {
    node.items[0].bounds = node.bounds;
  }
}
