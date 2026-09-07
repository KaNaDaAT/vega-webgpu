# WebGPU Renderer for [Vega](https://vega.github.io/vega)

[![CI](https://github.com/KaNaDaAT/vega-webgpu/actions/workflows/ci.yml/badge.svg)](https://github.com/KaNaDaAT/vega-webgpu/actions/workflows/ci.yml)

A GPU-accelerated renderer plugin for Vega, registered as `renderer: 'webgpu'`. Marks are triangulated and drawn with WebGPU (instanced where possible). Text is rasterized into a glyph atlas and drawn as instanced quads.

[Live demo](https://kanadaat.github.io/vega-webgpu/test). For a stress test, try the `splom-outer-50k` spec (50,000 points, where canvas and svg slow down or crash) or `benchmark` (signal-controlled up to 300k animated points).

Started by [lsh](https://github.com/lsh) in [vega/vega-webgpu](https://github.com/vega/vega-webgpu), continued by [KaNaDaAT](https://github.com/KaNaDaAT). The goal of this fork is to mature the renderer into an official Vega renderer (see [vega/vega-webgpu#21](https://github.com/vega/vega-webgpu/pull/21)).

**Note:** The WebGPU renderer is a work in progress and might not be suitable for all production use.

## Usage

### Script tag

The renderer registers itself when loaded after Vega:

```html
<script src="https://cdn.jsdelivr.net/npm/vega@6/build/vega.min.js"></script>
<script src="https://kanadaat.github.io/vega-webgpu/releases/1_2_0/vega-webgpu-renderer.js"></script>
<div id="vis"></div>
<script>
  fetch('https://vega.github.io/vega/examples/bar-chart.vg.json')
    .then(res => res.json())
    .then(spec => {
      new vega.View(vega.parse(spec), {
        renderer: 'webgpu',
        container: '#vis',
        hover: true,
      }).runAsync();
    });
</script>
```

All hosted versions are listed at [releases](https://kanadaat.github.io/vega-webgpu/releases). Versions before 2.0 were built for Vega 5.

### npm

```bash
npm install vega-webgpu-renderer
```

```js
import 'vega-webgpu-renderer'; // registers the 'webgpu' renderer
```

## Renderer options

Options live on `view._renderer.wgOptions`:

```js
const view = new vega.View(vega.parse(spec), { renderer: 'webgpu', container: '#vis' });
view._renderer.wgOptions.debugLog = true;
```

| Option | Description | Default | Since |
| --- | --- | --- | --- |
| `debugLog` | Log per-frame render timings to the console. | `false` | 1.0.0 |
| `renderLock` | Skip re-entrant render calls while a frame is in flight. The most recent request always runs. Improves responsiveness of interactive charts. | `true` | 1.1.1 |
| `renderBatch` | Draw each line mark as one instanced call. When `false`, segments of consecutive line marks are accumulated into a single draw call instead (helps e.g. parallel coordinates). | `true` | 1.2.0 |
| `sampleCount` | MSAA samples per pixel: `4` (antialiased) or `1` (plain single-sampled rendering). Can be changed between frames. | `4` | 2.0.0 |
| `redrawOnZoom` | Follow browser zoom. Zoom changes `devicePixelRatio`, and the default re-sizes the canvas and redraws so the view stays sharp. When `false` the canvas holds the ratio it was first sized at and the browser scales it, which is softer but skips the redraw. | `true` | 2.0.0 |
| `cacheShapes` | Cache triangulated shape geometry between frames (experimental). | `false` | 1.1.0 |
| `simpleLine` | Deprecated since 1.2.0, superseded by `renderBatch`. | `true` | 1.0.0 |

## Supported marks & known limitations

Supported: rect, symbol (all shapes + rotation), line, area, arc, path, shape, rule, group, image, trail, text (rasterized into a GPU glyph atlas), rounded rect and group corners, line dashes, gradient fills (linear + radial) on rect, symbol, area, path, shape and arc marks, and gradient strokes on area, path, shape, arc and trail marks.

Not supported yet:

- Gradient strokes on symbol, rect, rule and line marks (a placeholder color is used)
- Radial gradients with an offset focal point (approximated as concentric circles)
- Miter and bevel line joins (round joins are used for all lines)

### Borders between abutting fills

Two polygons that share an edge, a choropleth's counties for instance, come out
without a line between them where canvas draws one.

That line is not something the spec asked for. Canvas fills each polygon
separately, so a shared edge takes about half of one fill over the background
and then about half of the next over that, and roughly a quarter of the
background survives as a pale seam. This renderer draws the polygons in one
multisampled pass, where the two fills split the samples between them and cover
the edge completely, so nothing shows through.

Reproducing the seam would mean giving each polygon its own fractional coverage,
which a triangulated fill cannot supply: the fragment would need its distance to
the polygon's outline, and the triangulation only knows its own edges, which have
to stay hard. So the seam is not reproduced.

Ask for the border instead, which is clearer about the intent and renders the
same everywhere:

```json
"encode": {
  "update": {
    "fill": {"scale": "color", "field": "rate"},
    "stroke": {"value": "#fff"},
    "strokeWidth": {"value": 0.5}
  }
}
```

`choropleth-stroked` and `map-fit-stroked` in `test/specs-valid` are the two
corpus specs of this kind written that way. Both track canvas more closely than
the versions that rely on the seam.

### Maximum canvas size

WebGPU caps a texture at `maxTextureDimension2D`, which is 8192 on most GPUs and
16384 on some desktop parts. The canvas is a texture, so no view can hold more
device pixels than that on either axis.

The cap is on **device** pixels, not CSS pixels, which is the part that catches
people out. The canvas is sized `width * devicePixelRatio`, so a 2x display
halves how wide a chart can be before it starts losing sharpness:

| devicePixelRatio | widest chart at full sharpness, 8192 cap |
| --- | --- |
| 1 | 8192 css px |
| 2 | 4096 css px |
| 3 | 2730 css px |

A long sorted bar list or a tall facet grid reaches this well before it looks
unreasonable.

The renderer reads the cap from the GPU adapter and lowers the ratio to fit
rather than refusing to draw, so a large view stays on screen and only loses
sharpness. It says so once:

```
[vega-webgpu] 8192x300 at 2x needs 16384px, over the GPU's maximum texture size
(8192px). Drawing at 1.000x instead, so the view is softer than requested.
```

To get full sharpness back, keep `width * devicePixelRatio` and
`height * devicePixelRatio` under the cap. To read the cap on the current
machine:

```js
(await navigator.gpu.requestAdapter()).limits.maxTextureDimension2D;
```

Setting `redrawOnZoom` to `false` also helps here, since zooming in then cannot
push a view that already fits back over the cap.

## Development

The demo page fills its spec picker from `test/specs-valid.json`, which is
generated from `test/specs-valid/` by `npm run manifest` (and by `npm run
build`). Drop a `.vg.json` in and rebuild rather than editing the list. To keep
one out of the picker, name it in an optional `test/specs-ignore.json`:

```json
["benchmark", "splom-outer-50k"]
```

A test fails if the manifest falls behind the directory.



```bash
npm install
npm run build      # UMD + minified + ESM bundles and type declarations into build/
npm run dev        # rollup watch mode
npm run serve      # serve the repo at http://localhost:5500
npm run typecheck  # strict TypeScript, no emit
npm run lint       # eslint
```

Open `http://localhost:5500/test/?spec=bar&renderer=webgpu&version=dev` to run the local build against any spec from `test/specs-valid`.

### Render tests (WebGPU vs canvas)

`npm test` renders a corpus of official Vega specs ([test/render/specs.ts](test/render/specs.ts)) in headless Chromium (WebGPU on SwiftShader) with **both** the WebGPU and canvas renderers and compares the two directly. The canvas renderer is the ground truth. There are no stored image baselines to drift. Each run pixel-diffs the two renderers with a low tolerance, and asserts that each renderer actually ran (no silent fallback). Known, documented differences (e.g. non-circular symbols) get a per-spec budget in [test/render/specs.ts](test/render/specs.ts).

Alongside the specs, the same run renders the scenegraph fixtures in [test/render/scenes](test/render/scenes). Those are stored scenegraphs handed straight to the renderer, with no View, dataflow or layout in between, so a failure is pinned to the mark code. Vega tests its own renderers the same way. Add a fixture by dropping a JSON file in that directory: `{ "description", "width", "height", "origin", "scene" }`, where `scene` is what `vega.sceneToJSON` produces.

```bash
npx playwright install chromium --no-shell   # once
npm test                                     # render both renderers and compare
```

If Playwright's bundled Chromium cannot run on your machine, point the tests at any Chromium-family browser (Chrome, Edge, Brave, ...):

```bash
# macOS/Linux
PLAYWRIGHT_BROWSER_PATH="/path/to/chrome" npm test
# Windows (PowerShell)
$env:PLAYWRIGHT_BROWSER_PATH="C:\Path\To\chrome.exe"; npm test
```

Other useful invocations:

```bash
npx playwright test -g bar   # a single spec by name
npm run test:diffs           # print the per-spec webgpu-vs-canvas diff %
npm run test:report          # open the last run's HTML report
npm run test:artifacts       # also write every spec's PNGs to disk (see below)
```

#### Inspecting the results

Every run produces an HTML report at `playwright-report/` with **each** spec's WebGPU render, canvas render, and diff image attached, passing specs included, so it doubles as a browsable comparison gallery. Open it with:

```bash
npm run test:report
```

For a plain folder of images you can diff with any tool, set `RENDER_ARTIFACTS=1` (or run `npm run test:artifacts`). Every spec's `<spec>-webgpu.png`, `<spec>-canvas.png`, and `<spec>-diff.png` are written to `test/render/output/` (gitignored) on every run, pass or fail. CI uploads both the report (`render-report`) and the raw images (`render-images`) as downloadable artifacts.

## Releasing

Releases are automated by [.github/workflows/release.yml](.github/workflows/release.yml):

1. Bump `version` in `package.json` (and commit to `main`).
2. Tag and push: `git tag -a v2.0.0 -m "Release notes" && git push origin v2.0.0`

The workflow verifies the tag matches `package.json`, builds, attaches the bundles to a GitHub Release, publishes the hosted files to `releases/<x_y_z>/` on GitHub Pages, and publishes to npm when the `NPM_TOKEN` secret is configured.

## Contributing

Contributions are welcome. WebGPU 2D rendering has few reference implementations, which makes this project both tricky and rewarding. Please make sure `npm run typecheck`, `npm run lint`, and `npm test` pass.

## License

ISC
