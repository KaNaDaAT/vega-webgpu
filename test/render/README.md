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
