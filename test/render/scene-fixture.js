/**
 * Turning a stored scenegraph fixture into something a renderer can draw.
 *
 * Shared by scene-harness.js, which the suite drives, and gallery.js, whose
 * live view draws a fixture here and now. Both have to build the same scene or
 * the gallery would be showing something the suite never measured.
 */
window.SceneFixture = (() => {
  /**
   * A `shape` mark's own shape, which vega's geoshape transform sets to a d3
   * style generator: called with a context it draws, called with none it
   * returns the path. JSON cannot carry one, so a fixture names a fixed svg
   * path and this wraps it in the same two-faced generator both renderers
   * expect.
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
   * JSON has no literal for NaN or Infinity, so hostile fixtures carry them as
   * sentinels, and no literal for a function, so the two vega parses into one
   * are named by the path they draw.
   */
  function revive(_key, value) {
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
    // A nested mark draws its whole series from items[0], and the gradient on
    // it reads that item's bounds, which boundMark leaves empty.
    if (vega.Marks[node.marktype]?.nested && node.items?.length) {
      node.items[0].bounds = node.bounds;
    }
  }

  /** The stored json, from a base the caller resolves against. */
  async function load(base, name, dir = 'scenes') {
    const res = await fetch(`${base}${dir}/${name}.json`);
    if (!res.ok) {
      throw new Error(`Failed to load scene '${name}': ${res.status}`);
    }
    return res.json();
  }

  /** The bound scenegraph, rebuilt from the fixture each time it is asked for. */
  function sceneOf(fixture) {
    const scene = vega.sceneFromJSON(JSON.parse(JSON.stringify(fixture.scene), revive));
    boundScene(scene);
    return scene;
  }

  /**
   * Draws a fixture with one renderer into `host`, the way the suite draws it:
   * the renderer directly, with no View, no dataflow and no layout between the
   * scenegraph and the mark code.
   */
  async function render(fixture, rendererName, host) {
    const module = vega.renderModule(rendererName);
    if (!module?.renderer) {
      throw new Error(`No renderer registered for '${rendererName}'.`);
    }
    const r = new module.renderer();
    r.initialize(host, fixture.width, fixture.height, fixture.origin ?? [0, 0]);
    r.background(fixture.background ?? '#ffffff');
    await r.renderAsync(sceneOf(fixture));
    return r;
  }

  return { load, render, sceneOf, boundScene, shapeGenerator };
})();
