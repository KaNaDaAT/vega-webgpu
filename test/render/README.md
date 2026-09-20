# What the render suite measures, and what it lets through

Every case renders the same scene with the canvas renderer and with this one and compares the two. Canvas is the ground truth. There are no stored baseline images, so a case cannot drift by having its baseline re-blessed.

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

Every measure is a comparison, so two blank renders agree on all six and the case goes green having tested nothing. One url that 404s, one mark dropped in both renderers, or a fixture that loses its items is enough. Each comparison therefore also asserts that the two renders drew on at least 0.5% of the frame. Over the 177 cases in the corpus the least inked is `rule-degenerate` at 1.60% and the sparsest spec is `panzoom` at 1.70%, so the floor only fires on a case that is effectively blank.

## What has no fixture

- **The `shape` mark.** Its `shape` is a d3 style generator function carrying a `context` setter, which is what `src/path/shapes.ts` calls, and `sceneToJSON` cannot carry a function. A stored scenegraph cannot express one, so there is no `shape-*` fixture and there cannot be one without teaching the harness to build a generator, which would stop a fixture being a scenegraph handed straight to the renderer. It is covered by the specs instead, where a projection builds the generator: choropleth, map-fit, map-fit-stroked, map-bind and map-point-radius all draw through it.
- **An image url that fails to load.** A broken image is `complete` and carries no pixels, and `drawImage` throws on one, so the canvas renderer loses the whole frame and leaves nothing to compare against. Measured on a 404, an undecodable data url and an empty url: canvas rejects its render with `InvalidStateError`. This renderer did the same until the image mark learned to skip an image with no pixels in it, and what holds that is `scenes-hostile/image-broken`, which asserts one bad url does not take the rest of the frame with it.
- **Curve types have no enum to check against.** `releases/vega-enums.js` is generated from vega's schema and carries `blend`, `strokeCap` and `strokeJoin`. Every value of those three is drawn by some fixture, and `scene.spec.ts` holds that against the same generator, so a vega release adding one fails here. The schema does not enumerate `interpolate` or a symbol `shape`, and vega-scenegraph keeps both lists private to their own modules, so there is no authority to audit those two against. `line-interpolate` covers every key of the curve lookup as it stands today and `symbol-shapes` with `symbol-analytic` covers every built-in symbol, but neither will notice vega adding one.

## Overrides

A budget above the default is an exception and carries the measured number and the reason in a comment beside it. They live in `scenes.ts` for fixtures and `specs.ts` for specs.

An override says "the two renderers legitimately differ here". It is not for a case we know is wrong. Raising a budget past what a measure reports writes a defect down as if it were a tolerance, and the next person cannot tell the two apart.

## Skips

A case we know is wrong is skipped with its reason, in `skippedScenes`, and listed here. A skip is loud, an inflated budget is silent.

### `text-variants`

Stroked text sits about a pixel off where canvas puts it. The worst block reads 171 against 60 for the same labels drawn without a stroke, and every stroked column of the grid is between 133 and 181 while the unstroked column passes. The single-pixel measure this suite used before hid it inside a budget of 230.

Unstroked text is still covered, by `text-layout`, `text-gradients` and `text-baseline-phase`.

Will be fixed in a future version.

### `line-curve-caps`

The curve shaders evaluate a cubic on the GPU and draw no cap, so a round stroke cap on a basis, cardinal, monotone, catmull-rom or natural line ends flat. `linear` and the step family tessellate and are exact.

Routing a capped curve to the tessellated path does cap it, and moves the curve itself further from canvas: measured on this fixture the differing pixels went from 80 to 145. So the cap belongs in the curve shader, or as a pair of discs drawn through the segment shader at the ends of each run. A square cap already takes the tessellated path and is exact there.

Will be fixed in a future version.

## Known differences that are gated rather than skipped

These are real and measured, and the case still earns its place because the rest of what it covers is exact.

- `rect-gradient-border` carries a `bias` of 3 against a default of 2. A mark spans its gradient over its own box where canvas spans it over `item.bounds`, which carry half the stroke, so every inked pixel of a gradient fill sits a level or two along the ramp. Solid fills on the same fixture are exact and the other gradient fixtures read 0.00. The fixture exists to gate the routing fix underneath that, which it does through `diff` and `quad`.
