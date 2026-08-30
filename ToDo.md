# vega-webgpu roadmap

Tracking the gap to a production-grade, canvas-matching WebGPU renderer. Items are grouped by theme, each noting the observed symptom and the fix.

## Rendering fidelity

- [x] **Text blur fixed, rotation and sub-pixel placement.** Each glyph is rasterized into its axis-aligned bounding box (rotation baked in) at its real sub-pixel phase, then drawn as a plain quad on a whole device pixel, so it maps 1:1 to device pixels (crisp, no resampling) _and_ lands exactly where canvas draws it instead of snapped up to half a pixel away. The cache is keyed by dpr, angle and quantized phase (8 steps/px). Rotated radial labels (arc-diagram) ~3.7% to 0.8%. Dense small labels (barley) ~3.2% to 1.0%. Follow-up: SDF/atlas text to close the last text-dense fringe.
- [x] **Rect fill inset fixed.** Rect marks carrying a `strokeWidth` but no `stroke` (common: stroke set on hover only) reserved a transparent stroke band and rendered ~strokeWidth/2 px too small on every edge. Canvas ignores `strokeWidth` when there is no stroke, so we now do too (nested-plot 4.7% to 0.8%).
- [ ] **Thin strokes are harder/sharper than canvas** (rules, 1px lines, e.g. playfair's price lines, axis domain lines). The rule/line fills rely on 4x MSAA, coarser than canvas's analytic edge AA, so a 1px line reads as one hard column instead of a soft ~2px one. Fix: analytic-AA (SDF) for the rule and thin-line fills, like the symbol/rounded-rect shaders already do. Note: naive stroke-centering alone _regresses_ the cross-check (hops 0.54% to 1.13%). The softness, not the position, is the dominant term.
- [ ] **Symbol outlines look slightly off** on some specs (e.g. autosize `fit`).
- [ ] **choropleth**: geographic outlines differ from canvas.
- [ ] **map-point-radius**: stray "flying line" in the top-left corner (bug).
- [ ] **scatter-plot-contours**: contour lines are drawn very differently from canvas (line construction/curve handling).
- [ ] **tree-radial-bundle**: curved links render differently from canvas even though other curved-link specs match, something specific to this spec's curve/interpolation settings.
- [ ] **Line joins**: round joins are used, canvas defaults to miter. Route lines through extrude-polyline (like area/path) for miter parity.

## Missing features

- [ ] **Line dashes / line types** (`strokeDash`) are not supported.
- [x] **Symbol shapes**: all shapes (square, cross, diamond, triangle-\*, arrow, wedge, stroke, custom SVG) plus `angle` rotation now render. Circles keep the analytic shader. Other shapes are triangulated once per (shape, size) and instanced. `symbol-shapes` 6.8% to 0.03%, `symbol-angle` 14.3% to 0.001%.
- [x] **Gradient on symbols**: gradient-filled symbols (e.g. a legend swatch) now render via the gradient pipeline (triangulated, per item). The `gradient` spec's radial-gradient circle went 4.6% to 0.007%.
- [ ] **Trail marks** are not implemented.
- [ ] **Blend modes** (`blend`) are ignored.

## Performance

- [ ] **Line/"graph" charts are much slower than canvas**, and interactive updates (choropleth pan/hover) lag badly. Root cause: geometry is re-triangulated and re-uploaded every frame. Fix: retained per-mark geometry rebuilt only when dirty, move curve flattening and triangulation to compute shaders, single render pass (done) plus instanced batching.
- [ ] **movies-sort**: ~3.4 s draw (giant 95k-px-tall canvas).

## Robustness / bugs

- [ ] **Oversized canvas crash** (movies-sort): a 95356-px-tall canvas exceeds WebGPU's `maxTextureDimension2D` (8192) so the MSAA/depth/swapchain textures fail to create and the frame errors out. Short-term: detect the limit, warn once, and skip the frame instead of crashing (implemented). Long-term: tiled rendering for canvases larger than the texture limit.
- [ ] `powerPreference` warning on Windows (cosmetic, crbug.com/369219127).

### Known issues (from code review)

Findings from a full review of the working tree. Fixed items are kept for the record, open ones are ordered by severity.

- [x] **`renderLock` resolved `renderAsync` too early.** A render arriving mid-frame was coalesced into `_pendingRender`, but `_renderPromise` still pointed at the already-settled in-flight frame, so `renderAsync` (and the test harness) resolved before the newest scene was drawn, screenshotting a stale canvas. Deferred renders now expose a stand-in promise that settles only once the flushed frame does.
- [x] **A failed frame wedged the renderer.** `_render`'s `catch` cleared `_isRendering` but never flushed `_pendingRender`, so a queued render was silently dropped and its awaiter hung forever. All frame exits (completion, early return, failure) now drain through one `_finishFrame` path.
- [x] **The oversized-canvas early return stranded pending work** for the same reason. It now drains through `_finishFrame` too.
- [x] **Dead dirty-bounds tracking.** The `dirty()` override walked the group chain and unioned bounds into `_dirty`/`_tempb` on every item, but nothing ever read them, every frame redraws the whole scene. Removed, reinstate with partial redraw.
- [ ] **`_frame` reconfigures the swapchain on every call** even when nothing changed. Cache the last `{device, format, size}` and skip redundant `configure()`.
- [ ] **Per-item buffer churn in `text`/`rect` gradient paths**: a uniform buffer, bind group and vertex buffer are allocated per item per frame and never explicitly released, leaning entirely on GC. Pool or batch them (ties into the retained-geometry work under Performance).
- [ ] **`markClip` allocates a scissor rect per mark per frame**. Hoist to the mark's cached resources.

## Tests (current focus)

- [ ] **Test integrity**: some specs pass the cross-check despite visibly wrong output (e.g. `chart` symbol shapes). Investigate why and make the suite catch it (render size, missing marks, viewport).
- [x] **All specs are tested.** The corpus is derived from `test/specs-valid` (all 117 specs) minus 9 documented exclusions (remote data, force layouts, wordcloud, stress demos, oversized movies-sort). New specs are picked up automatically. Gap-revealing specs (tree-radial-bundle ~12%, symbol-shapes ~7%) are tested with documented budgets that fail on regression.
- [ ] **Add line-dash and curve-type canaries** (focused, feature-dominated like `symbol-shapes`) so those gaps aren't diluted either.
- [ ] **Parameter coverage**: exercise multiple settings per feature (curve types, symbol shapes, line dashes, autosize modes) so regressions in a single parameter are caught.
- [x] **Inspectable output**: HTML report with each spec's webgpu/canvas/diff attached (always, passing specs included). `RENDER_ARTIFACTS=1` also writes the raw per-spec PNGs to `test/render/output/`. CI uploads both the report (`render-report`) and the raw images (`render-images`) as downloadable artifacts.
- [ ] **Run the full check suite on GitHub**: typecheck, lint, build and the render tests all run in GitHub Actions on every push/PR ([ci.yml](.github/workflows/ci.yml)), uploading the report + raw images as artifacts (done). Still to do: publish the HTML render report to GitHub Pages so the webgpu-vs-canvas gallery is browsable online next to the live demo, not only as a download, and gate merges on the checks passing.

## Official-renderer path

- [ ] PR to widen vega-typings `Renderers` union to include `'webgpu'`.
- [ ] Publish to npm, revive vega/vega-webgpu#21.
