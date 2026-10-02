# WebGPU Renderer for [Vega](https://vega.github.io/vega)

[![CI](https://github.com/KaNaDaAT/vega-webgpu/actions/workflows/ci.yml/badge.svg)](https://github.com/KaNaDaAT/vega-webgpu/actions/workflows/ci.yml)

A third renderer for Vega, next to canvas and svg, that draws the scenegraph with WebGPU. It registers as `renderer: 'webgpu'`, so a spec needs no changes.

Canvas is the reference. Every spec in the corpus is drawn by both renderers and compared on every commit, and what still differs is documented.

- [Project page](https://kanadaat.github.io/vega-webgpu/): features, known differences from canvas, roadmap and every hosted version
- [Live demo](https://kanadaat.github.io/vega-webgpu/test/): any spec from the corpus, with canvas beside it and a pixel diff. `benchmark` animates up to 300k points
- [Mark playground](https://kanadaat.github.io/vega-webgpu/releases/marks.html): one mark at a time, with its properties to switch on and off
- [Render gallery](https://kanadaat.github.io/vega-webgpu/gallery/): every case with its measured difference, for each of the last ten runs on main and for every release. `?run=<sha>` or `?run=2.0.0` picks one

Started by [lsh](https://github.com/lsh) in [vega/vega-webgpu](https://github.com/vega/vega-webgpu), continued by [KaNaDaAT](https://github.com/KaNaDaAT). The goal is to make it an official Vega renderer (see [vega/vega-webgpu#21](https://github.com/vega/vega-webgpu/pull/21)).

## Usage

Load it after Vega and it registers itself:

```html
<script src="https://cdn.jsdelivr.net/npm/vega@6/build/vega.min.js"></script>
<script src="https://kanadaat.github.io/vega-webgpu/releases/2_0_0-rc4/vega-webgpu-renderer.js"></script>
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

2.0.0 and later need Vega 6. The 1.x builds need Vega 5 and fail next to Vega 6. Every hosted build is listed under [versions](https://kanadaat.github.io/vega-webgpu/#versions).

Without `navigator.gpu`, `'webgpu'` draws with the canvas renderer and warns. A browser can also have `navigator.gpu` and no adapter, a blocklisted GPU for instance, and then nothing is drawn. To fall back there too, pick the renderer from the adapter:

```js
const renderer = (await navigator.gpu?.requestAdapter()) ? 'webgpu' : 'canvas';
```

## Options

Options live on `view._renderer.wgOptions` and can be changed between frames:

```js
view._renderer.wgOptions.debugLog = true;
```

| Option | What it does | Default |
| --- | --- | --- |
| `sampleCount` | MSAA samples per pixel, `4` or `1`. | `4` |
| `redrawOnZoom` | Resize and redraw when browser zoom changes the pixel ratio. When `false` the canvas keeps its first ratio and the browser scales it. | `true` |
| `renderLock` | While a frame is in flight, keep only the latest render call and run it next. | `true` |
| `cacheShapes` | Keep triangulated geometry between frames. | `true` |
| `canvasTextDrift` | Place each label where the canvas renderer would, which can be a row off on a half pixel baseline. Only for matching a canvas view side by side. | `false` |
| `offscreen` | Draw into a texture the renderer owns and leave the canvas blank, for a headless runner with no compositor. Read the frame with `captureFrame()`. | `false` |
| `debugLog` | Log per-frame timings to the console. | `false` |

`renderBatch` and `simpleLine` were removed in 2.0.0.

## Features and limitations

All twelve Vega mark types are drawn, with gradient fills and strokes, dashes, caps, joins and every blend mode. The [project page](https://kanadaat.github.io/vega-webgpu/#features) has the per-mark table and the known differences from canvas. [ToDo.md](ToDo.md) has the full list, with the measurement behind each item.

## Development

```bash
npm install
npm run build      # bundles and type declarations into build/
npm run serve      # the repo at http://localhost:5500
npm run dev        # rollup in watch mode
npm run typecheck
npm run lint
```

Then open `http://localhost:5500/test/?spec=bar&renderer=webgpu&version=dev` to run the local build against any spec in `test/specs-valid`.

To add a spec, drop a `.vg.json` into `test/specs-valid` and build, which regenerates the list the demo page and the suite read. A test fails if that list falls behind the directory. Name a spec in an optional `test/specs-ignore.json` to keep it out of the demo page's picker.

To add a scenegraph fixture, drop a JSON file into `test/render/scenes`: `{ "description", "width", "height", "origin", "scene" }`, where `scene` is what `vega.sceneToJSON` produces. A fixture skips the View, the dataflow and the layout, so a failure there is in the mark code.

### Render tests

`npm test` draws every spec in `test/specs-valid` and every scenegraph fixture in `test/render/scenes` with both renderers in headless Chromium (WebGPU on SwiftShader), and compares the two. Canvas is the reference, so there are no stored baselines. A known difference carries its own budget in `test/render/specs.ts` or `test/render/scenes.ts`. The suite loads the built bundle, so build first.

```bash
npx playwright install chromium --no-shell   # once
npm run build
npm test
npx playwright test -g bar                   # one spec by name
npm run test:report                          # the last run's HTML report
npm run gallery:record                       # write every case to test/render/output
npm run gallery                              # and browse them
```

If Playwright's Chromium does not run on your machine, set `PLAYWRIGHT_BROWSER_PATH` to any Chromium-based browser.

## Releasing

`npm run release -- <version>` bumps the version, runs the checks, commits, tags and pushes. The tag starts the workflow that hosts the build and creates the GitHub release. See [Release.md](Release.md).

## Contributing

Contributions are welcome. Please make sure `npm run typecheck`, `npm run lint` and `npm test` pass.

## License

BSD-3-Clause, the same as Vega. See [LICENSE](LICENSE).
