# What the render suite measures, and what it lets through

Every case renders the same scene with the canvas renderer and with this one and compares the two. Canvas is the ground truth. There are no stored baseline images, so a case cannot drift by having its baseline re-blessed.

## A fixture and a spec

Every case is one of two kinds, and which one it is decides what a failure means.

A **fixture** is a stored scenegraph in `scenes/`, handed straight to `renderer.renderAsync`. There is no View, no dataflow, no scales and no layout between the JSON and the mark code, so when a fixture differs from canvas the renderer did it. That is why almost every bug is pinned with one.

A **spec** is a real vega spec in `../specs-valid/`, parsed into a View which runs its transforms and layout and builds a scenegraph of its own. A spec covers the whole stack, so a difference could be ours or anything vega did upstream of it. It tells you something broke rather than where.

Three consequences worth knowing before adding a case.

- A fixture is held to all six measures and a spec to five: `render.spec.ts` passes no `quad`, because a spec carries enough text that the worst block fires on rasterization differences that are not defects. The differing-pixel default is 0.2% for a fixture against 0.8% for a spec, since a fixture is small synthetic geometry where a local difference means something.
- A fixture cannot change out from under you. vega changing how it lays a chart out cannot move a stored scenegraph.
- A fixture cannot carry a function, because `sceneToJSON` cannot serialize one. A shape generator and vega's `clip: {path}` form are both functions, which is what the `__shapePath__` and `__clipPath__` revivers in `scene-harness.js` exist for. Nor can a fixture reach anything a View does: hover, brush, a data update, a mark added between frames. That category is spec only.

Reach for a fixture first. A spec earns its place where the thing under test is the stack rather than the renderer.

## The measures

Six, each answering a question the others cannot. A fixture is held to all six; a spec carries too much text for `quad`, so it is held to the other five.

| measure | question | default |
| --- | --- | --- |
| `diff` | how much of the frame moved | 0.2% of pixels for a fixture, 0.8% for a spec |
| `quad` | how wrong is the worst place, locally | 70 channel levels |
| `bias` | is the whole render off in one direction | 2 channel levels |
| `mean` | is the whole render off by a lot, either direction | 10 channel levels |
| `flat` | is the colour wrong away from any edge | 3 channel levels, where 1000 interior pixels can be sampled |
| `tile` | is one small region badly wrong | 35% of a 32px square |

`diff` counts pixels past a colour threshold, so it sees a mark in the wrong place and is blind to a render that is uniformly a few levels dark.

`quad` averages each block of two scene pixels a side before comparing, and is the local measure. Comparing single pixels instead reads 255 wherever one antialiased edge pixel falls the other side of a rounding boundary, which happens all over a correct render: that measure needed 28 per-fixture budgets, 17 more for a finer grid and 4 more for CI. Because the block is sized in scene units, a finer device grid splits the same area into more, smaller pixels and the reading does not move, so one number covers every pixel ratio.

`bias` is the signed mean over inked pixels. It is the only measure that sees a systematic error: `gate.spec.ts` darkens a render by four levels and shows the pixel count and the unsigned mean both report a pass while this fires.

`mean` is the unsigned mean over inked pixels, for an error too large to be antialiasing but too scattered to be one-sided.

`flat` is the mean over inked pixels whose neighbourhood is flat in both renders, so neither a moved edge nor one the two rasterizers merely disagree about. What is left is the colour itself. Text and thin lines have no interior to sample, so it only applies where 1000 such pixels exist.

`tile` is the worst 32 pixel square, as a fraction of that square. The whole-image count is diluted by however much of a case is empty, so a small region that is badly wrong reads as a faint haze over everything.

## What proves each measure

`gate.spec.ts` is the table above made executable. Each case takes one real render, injects one kind of error into a copy of it and compares the two, so the numbers are the error rather than an argument about one. Every case shows its own measure firing while the rest stay inside the same defaults the suite gates on. A measure with no case here is a measure nobody has shown earns its place.

| injected error | drawn from | fires | the others read |
| --- | --- | --- | --- |
| every drawn pixel 4 levels darker | stocks-index | `bias` 2.86 | diff 0.000%, tile 0.0%, quad 4.0, mean 2.91 |
| every inked pixel 16 levels, direction alternating | stocks-index | `mean` 15.65 | diff 0.000%, tile 0.0%, quad 8.0, bias 0.38 |
| a 6 pixel blot, 255 levels | symbol-variants | `quad` 255 | diff 0.025%, tile 3.5%, mean 0.35, bias 0.35, flat 0.23 |
| a 22 pixel blot, 45 levels | bar | `tile` 47.3% | diff 0.481%, quad 45.0, mean 0.58, bias 0.58, flat 0.50 |
| interiors 5 levels, direction flipping every 16 pixels | symbol-variants | `flat` 5.00 over 13904px | diff 0.000%, tile 0.0%, quad 5.0, mean 3.36, bias 0.02 |
| 32 rows moved 2 pixels sideways | bar | `diff` 1.107% | tile 14.4%, mean 5.25, bias 0.00, flat 0.00 over 29904px |

Two of those want reading twice.

`tile` separates from `diff` only on a spec. 35% of a 32 pixel square is 358 pixels, and a fixture holds a 0.2% differing-pixel budget, so the same blot on a 680x216 fixture reads 0.330% and the pixel count fires first whatever the tile says. It earns its place on the larger frames, where 358 pixels is a fraction of the budget rather than twice it.

`diff` is alone on a displaced mark only because a spec is not held to `quad`. The worst block reads 185 on that case, so on a fixture the two fire together. The three colour measures are blind to it by construction: a displacement takes ink off one edge and puts it on the other, so the signed mean cancels, the unsigned mean is diluted by the ink that did not move, and nothing away from an edge changes at all.

The readings above are at dpr 1, and two of the six move with the pixel ratio. An injected error compared against a share of the whole frame has to be sized in scene units or it describes a quarter of the scene at dpr 2: the displaced band is sized that way, and reads 1.101% at dpr 2 against the 1.107% in the table. A blot is left in device pixels instead, because `tile` is a 32 device pixel square and the two have to share their units for the fraction to mean the same thing at either ratio. And how much interior a case has is a property of the grid rather than of the case: `stocks-index` has none to sample at dpr 1 and 4073 pixels of it at dpr 2, where `flat` reads 4.00 and catches the darkening on its own.

## A case that draws nothing

Every measure is a comparison, so two blank renders agree on all six and the case goes green having tested nothing. One url that 404s, one mark dropped in both renderers, or a fixture that loses its items is enough. Each comparison therefore also asserts that the two renders drew on at least 0.5% of the frame. Over the 193 cases in the corpus the least inked is `rule-degenerate` at 1.60% and the sparsest spec is `panzoom` at 1.70%, so the floor only fires on a case that is effectively blank.

Emptying the items of `shape-placement` reads 0.00% ink, and every one of the six then reads zero and passes. The floor is the only thing that fails it.

## What has no fixture

- **A `shape` mark drawn from a projection.** Its `shape` is a d3 style generator carrying a `context` setter, and `sceneToJSON` cannot carry a function. `{"__shapePath__": "M..."}` in a fixture builds the same two-faced generator over a fixed svg path, which is what `blend-overlap` uses, so a shape mark can be held to the mark-level measures. What that cannot reach is the projection behind a real one, and the geometry it produces: choropleth, map-fit, map-fit-stroked, map-bind and map-point-radius cover that as specs. `{"__clipPath__": "M..."}` is the same idea for the clip generator vega's `clip: {path}` form parses to.
- **An image url that fails to load.** A broken image is `complete` and carries no pixels, and `drawImage` throws on one, so the canvas renderer loses the whole frame and leaves nothing to compare against. Measured on a 404, an undecodable data url and an empty url: canvas rejects its render with `InvalidStateError`. This renderer did the same until the image mark learned to skip an image with no pixels in it, and what holds that is `scenes-hostile/image-broken`, which asserts one bad url does not take the rest of the frame with it.
- **Curve types have no enum to check against.** `releases/vega-enums.js` is generated from vega's schema and carries `blend`, `strokeCap`, `strokeJoin`, `align` and `baseline`. Every value of those five is drawn by some fixture, and `scene.spec.ts` holds that against the same generator, so a vega release adding one fails here. The schema does not enumerate `interpolate` or a symbol `shape`, and vega-scenegraph keeps both lists private to their own modules, so there is no authority to audit those two against. `line-interpolate` covers all 17 keys of the curve lookup as it stands today and `symbol-shapes` with `symbol-analytic` covers all 12 built-in symbols, but neither will notice vega adding one.
- **`fontWeight`, which is the sixth enumerable mark property.** The schema lists 13 values for it, `normal`, `bold`, `lighter`, `bolder` and the nine hundreds, and the fixtures draw three of them: `bold` and `lighter` in `text-flow` and `500` in `text-layout`. It is left out of the check rather than held, because a browser maps a range of weights onto whatever faces the family ships, so most of the missing ten would rasterize identically to one already drawn and the coverage would be nominal. The three that are drawn are three different faces, which is what the glyph cache key has to tell apart. The other three enumerable properties, `anchor`, `direction` and `orient`, belong to a title, a legend or an axis rather than to a mark, so a fixture cannot set them at all.
- **A clip edge whose antialiasing is half as dark as canvas leaves it.** `clip-coverage` is the case for it and records it rather than gating it. Applying the clip coverage twice on a stroke drawn through the mask moves the fixture from 0.011% of pixels to 0.023% and its worst block from 18.3 to 23.5, against a 0.2% and a 70 budget, and at dpr 2 from 0.002% to 0.003%. Folding the rounded box into the clip path's own mask moves it to 0.042% and 28.0, and to 0.015% at dpr 2. Both are the defects the fixture names, and every reading stays an order of magnitude inside the budgets, because the difference is one pixel wide along an arc a few hundred pixels long. Raising the contrast or lengthening the arc raises the noise with the signal. What the fixture does hold is that the clip is applied at all: dropping the coverage mask reads 14.004% on `clip-path-round`.

## The gallery

`gallery.html` browses what a run left in `output/`, side by side, wiped, blinked or as the diff, ranked by any of the numbers. `npm run gallery:record` fills it.

It has two sources. **Recorded** reads the pngs and the measurements a run wrote, which are the numbers the suite gated on. **Live** draws both renderers here and now, which is the only way to look at a case the run did not reach, or to see what this browser's own adapter does rather than the run's.

Live reports the same measures, computed in the browser by `compare-core.js` rather than read from the manifest, so they can be compared with the recorded ones directly. Two of them differ on purpose. The differing-pixel count is labelled `any difference`, because the gated count is pixelmatch on the node side at a colour threshold and that is not what runs here. And the whole live pair is this browser at its own pixel ratio on its own adapter, so a live number that disagrees with a recorded one by a little is the two machines disagreeing rather than a defect. The budgets are shown beside them for reference, and nothing in live mode is gated.

A fixture can be viewed live as well as a spec. It has no spec to run, so `scene-fixture.js` hands the stored scenegraph straight to a renderer, which is the same code the suite drives.

## Overrides

A budget above the default is an exception and carries the measured number and the reason in a comment beside it. They live in `scenes.ts` for fixtures and `specs.ts` for specs.

An override says "the two renderers legitimately differ here". It is not for a case we know is wrong. Raising a budget past what a measure reports writes a defect down as if it were a tolerance, and the next person cannot tell the two apart.

## Skips

A case we know is wrong is skipped with its reason, in `skippedScenes`, and listed here. Two of them. A skip is loud, an inflated budget is silent.

A skip is still drawn, still recorded and still shown. Its three pngs go to `output/` like any other case and its row is in the gallery, badged with the release it is queued for and carrying a banner that says the numbers below it are not held to anything. The test report gets the same milestone as an annotation, and [ToDo.md](../../ToDo.md) lists them under "Skipped in the render suite". So a skip costs its coverage and nothing else: the difference it names is on screen beside the cases that pass, rather than missing from the run.

`upstream` is the milestone for the one skip that is not ours to fix, where canvas is the side that is wrong and matching it would mean copying the defect.

### `clip-path-erase`, 2.1.0

Five of the Porter Duff operators, `source-in`, `destination-in`, `source-out`, `destination-atop` and `copy`, do something to the frame where the source is absent. Their composite therefore runs on every pixel it is scissored to rather than discarding the ones the mark does not cover, and a clip that is a path is only its bounding box to a scissor rect. canvas erases inside the path and leaves everything outside it alone.

Measured on this fixture, a `destination-in` rect inside a rounded blob: 7.330% of pixels differ, the worst tile is 69.9%, the signed mean is 22.08 and the worst block 180.3. What differs is the corners of the path's box, which canvas keeps and this erases.

The clip is applied by the mark that fills the layer, so the layer alpha already carries the coverage, and having the composite apply it again would square it on every blended mark. Confining an erasing operator properly means moving the clip off the mark and onto the composite for the layer route as a whole, which is a change to how every evaluated blend mode is drawn rather than a patch to this one case. A path clip with no blend on it is exact, and so is an erasing operator inside a box clip, which `blend-operators` covers.

### `gradient-diagonal`, upstream

`util/canvas/gradient.js` builds a canvas gradient only when the ramp is horizontal, vertical, or the item's bounds are square. Anything else it renders into an image the size of the bounds and hands to `createPattern(image, 'no-repeat')`, which is vega #2365. A pattern is placed at the origin of the coordinate space the fill happens in, and `drawPath` fills after the item translate has been undone, so it lands at the enclosing group's origin rather than at the mark. A mark further out than the bounds are wide is then filled with nothing at all.

Measured on this fixture: of the three non-square diagonal rects canvas draws one, partly, and leaves the other two blank. This renderer spans the ramp over the item's bounds wherever the mark is, for 23.057% of pixels differing, a 100% worst tile and a signed mean of 76.52. The square box and the horizontal ramp in the same fixture are the controls and match.

Matching this means deliberately not drawing marks, so it is a decision rather than a fix, and it wants reporting upstream first. A `symbol` reads differently again, drawn everywhere with a ramp that advances with x, which this has not pinned down.

Not ours to fix. The upstream report is the open item in ToDo.md.

## Known differences that are gated rather than skipped

These are real and measured, and the case still earns its place because the rest of what it covers is exact.

Two fixtures, both in `scenes.ts` with their measurement beside them.

- `group-variants` carries a `diff` of 0.4% against a default of 0.2%, and measures 0.230% at dpr 1 and 0.019% at dpr 2. Six dashed and capped borders on a corner radius, which is where the dash phase around a curve differs. `group-corner-dash` holds the same cause.
- `rule-diagonals` carries a `mean` of 26 against a default of 10, and measures 12.64 at dpr 1 and 6.99 at dpr 2. Both renderers approximate a slanted edge and neither is the reference for the other.

The spec lists are in `specs.ts`, each entry carrying its reading at both pixel ratios. `bias` has fifteen, the polygon seam model and the sparse specs whose ink is nearly all edge. `mean` has six: four geographic, one curve construction and one of many small labels. `diff` has five: `label` and `label-drift` are held tighter than the default rather than looser, and three are over it only because the case sits inside the default with no room left, `choropleth` measuring 0.770% against a default of 0.800%.

`diff` held seventeen entries before this round. Twelve are gone: the text and curve work closed the gap they were written for, and none of the twelve now reads over 0.56 of the default at either ratio, the largest being `map-fit` at 0.443% and `contour-scatter` at 0.438%. Eight of them read under 0.05%. A budget left far above what its case reads cannot tell a legitimate difference from a defect, which is the whole point of writing the measurement beside it.

`rect-gradient-border` was a third until this round. It held a `bias` of 3 against a default of 2 while a rect spanned its ramp over its own box rather than over `item.bounds`, and reads 0.21 on the default now that it spans the bounds.
