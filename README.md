# WebGPU Renderer for [Vega](https://vega.github.io/vega)

[![CI](https://github.com/KaNaDaAT/vega-webgpu/actions/workflows/ci.yml/badge.svg)](https://github.com/KaNaDaAT/vega-webgpu/actions/workflows/ci.yml)

A GPU-accelerated renderer plugin for Vega, registered as `renderer: 'webgpu'`. Marks are triangulated and drawn with WebGPU (instanced where possible). Text is drawn onto an overlaid 2D canvas.

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
| `cacheShapes` | Cache triangulated shape geometry between frames (experimental). | `false` | 1.1.0 |
| `simpleLine` | Deprecated since 1.2.0, superseded by `renderBatch`. | `true` | 1.0.0 |

## Supported marks & known limitations

Supported: rect, symbol (all shapes + rotation), line, area, arc, path, shape, rule, group, image, text (via 2D overlay), and gradient fills (linear + radial) on rect, symbol, area, path, shape and arc marks.

Not supported yet:

- Gradient strokes (a placeholder color is used)
- Radial gradients with an offset focal point (approximated as concentric circles)
- Rounded rect/group corners (corner radii are accepted but drawn square)
- Line dashes, and miter/bevel line joins (round joins are used for all lines)
- Trail marks

## Development

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
