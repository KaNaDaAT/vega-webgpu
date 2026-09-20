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
    // as sentinels. A clip that is a path generator is a function, which JSON
    // cannot carry either, so `{"__clipPath__": "M..."}` builds the same one
    // vega's parser builds for `clip: {path}`.
    const revive = (_key, value) => {
      if (value === '__NaN__') return NaN;
      if (value === '__Infinity__') return Infinity;
      if (value === '__-Infinity__') return -Infinity;
      if (value && typeof value === 'object' && typeof value.__clipPath__ === 'string') {
        const path = value.__clipPath__;
        const parsed = vega.pathParse(path);
        return context => (context ? vega.pathRender(context, parsed) : path);
      }
      if (value && typeof value === 'object' && typeof value.__shapePath__ === 'string') {
        return shapeGenerator(value.__shapePath__);
      }
      return value;
    };
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
 * A `shape` mark's own shape, which vega's geoshape transform sets to a d3
 * style generator: called with a context it draws, called with none it returns
 * the path. JSON cannot carry one, so a fixture names a fixed svg path and
 * this wraps it in the same two-faced generator the renderers both expect.
 */
function shapeGenerator(path) {
  const parsed = vega.pathParse(path);
  let target = null;
  const generator = () => {
    if (!target) return path;
    vega.pathRender(target, parsed);
    return undefined;
  };
  generator.context = context => {
    target = context;
    return generator;
  };
  return generator;
}

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
