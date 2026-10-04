/**
 * The measures the render suite gates on, in one place. compare.ts imports this
 * for its side effect, and the demo page and the gallery load it with a script
 * tag, so a number a page shows is the number the suite holds a case to.
 *
 * Plain script, no module, so a page can load it, and everything hangs off
 * `RenderMeasures`. An image is anything with a width, a height and RGBA bytes
 * row by row, which pngjs and ImageData both are. Both are flattened over white
 * before they get here.
 */
(function (global) {
  /** Largest neighbourhood spread a pixel may have and still count as flat. */
  const FLAT_EPS = 6;

  /**
   * Side of the block the local measure averages over, in scene pixels. Sized in
   * scene units so a finer device grid divides the same area into more, smaller
   * pixels and the reading does not move: `gradient-strokes` reads 52.0 at dpi 1
   * and 52.1 at dpi 2, where the single-pixel worst reads 128 and 191.
   */
  const BLOCK_SCENE_PX = 2;

  /**
   * Flat inked pixels a case needs before it is held to its flat budget. A
   * smaller sample is a handful of pixels deciding a whole spec.
   */
  const FLAT_MIN_SAMPLE = 1000;

  /**
   * Share of the frame a case has to draw on before its measures mean anything.
   *
   * Every one of the six is a comparison, so two renders that both draw nothing
   * agree perfectly and the case goes green having tested nothing: a fixture
   * whose url 404s, a spec whose data fails to parse, or a mark dropped in both
   * renderers all pass silently. Over the 193 cases in the corpus the least
   * inked is `rule-degenerate` at 1.60%, and `panzoom` is the sparsest spec at
   * 1.70%, so this sits a third of the way under the real floor and only fires
   * on a case that is effectively blank.
   */
  const INK_MIN_RATIO = 0.005;

  /** Whether a render drew on the pixel at byte offset `i`. */
  function inked(data, i) {
    return data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250;
  }

  /**
   * Worst-channel spread over each pixel's 3x3 neighbourhood, as a flatness map.
   * Separable: a horizontal pass, then a vertical one over its output, which is
   * the same answer as the 3x3 window for six reads rather than nine.
   */
  function spread(img) {
    const { width: w, height: h, data } = img;
    const rowLo = new Uint8Array(w * h);
    const rowHi = new Uint8Array(w * h);
    const out = new Uint8Array(w * h);
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let a = 255;
          let b = 0;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) {
              continue;
            }
            const v = data[(y * w + xx) * 4 + c];
            if (v < a) {
              a = v;
            }
            if (v > b) {
              b = v;
            }
          }
          rowLo[y * w + x] = a;
          rowHi[y * w + x] = b;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let a = 255;
          let b = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) {
              continue;
            }
            const i = yy * w + x;
            if (rowLo[i] < a) {
              a = rowLo[i];
            }
            if (rowHi[i] > b) {
              b = rowHi[i];
            }
          }
          const r = b - a;
          if (r > out[y * w + x]) {
            out[y * w + x] = r;
          }
        }
      }
    }
    return out;
  }

  /** Largest channel difference between block averages, over whole blocks of `side` pixels. */
  function blockDelta(imgA, imgB, side) {
    const { width: w, height: h } = imgA;
    let worst = 0;
    for (let y = 0; y + side <= h; y += side) {
      for (let x = 0; x + side <= w; x += side) {
        for (let c = 0; c < 3; c++) {
          let sa = 0;
          let sb = 0;
          for (let dy = 0; dy < side; dy++) {
            const row = (y + dy) * w;
            for (let dx = 0; dx < side; dx++) {
              const i = (row + x + dx) * 4 + c;
              sa += imgA.data[i];
              sb += imgB.data[i];
            }
          }
          const delta = Math.abs(sa - sb) / (side * side);
          if (delta > worst) {
            worst = delta;
          }
        }
      }
    }
    return worst;
  }

  /**
   * Per-channel error over two flattened images, with the local measure taken
   * over blocks of `blockSide` pixels.
   *
   * `mean` is the number worth gating on. The differing-pixel count ignores
   * anything under its colour threshold, which measures out at 39 levels on
   * every channel or 60 on one, so a render that is uniformly too dark or
   * carries a colour cast reports a perfect match. Averaging the error over
   * inked pixels catches exactly that, and stays near zero when the only
   * difference is a scattering of antialiased edge pixels, however far off any
   * one of them is.
   *
   * `quad` is the local measure. Comparing single pixels reads 255 wherever one
   * antialiased edge pixel lands on the other side of a rounding boundary, which
   * happens all over a legitimate render: 28 fixtures needed a budget of their
   * own for it, 17 more for a finer grid and 4 more for CI. Averaging each
   * block before comparing leaves a moved edge alone and still catches a mark
   * drawn in the wrong place or the wrong colour, and with the block sized in
   * scene units rather than device pixels it reads the same at either ratio.
   */
  function deltas(imgA, imgB, blockSide) {
    const flatA = spread(imgA);
    const flatB = spread(imgB);
    let sum = 0;
    let inkedCount = 0;
    const signed = [0, 0, 0];
    let touched = 0;
    let flatSum = 0;
    let flatSample = 0;
    for (let i = 0, p = 0; i < imgA.data.length; i += 4, p++) {
      let worst = 0;
      for (let c = 0; c < 3; c++) {
        const delta = Math.abs(imgA.data[i + c] - imgB.data[i + c]);
        if (delta > worst) {
          worst = delta;
        }
      }
      if (inked(imgA.data, i) || inked(imgB.data, i)) {
        inkedCount++;
        sum += worst;
        for (let c = 0; c < 3; c++) {
          signed[c] += imgA.data[i + c] - imgB.data[i + c];
        }
        // Flat in both, so neither an edge that moved nor one the two rasterizers
        // merely disagree about. What is left is the colour itself.
        if (flatA[p] <= FLAT_EPS && flatB[p] <= FLAT_EPS) {
          flatSample++;
          flatSum += worst;
        }
      }
      if (worst > 0) {
        touched++;
      }
    }
    const pixels = imgA.data.length / 4;
    return {
      quad: blockDelta(imgA, imgB, blockSide),
      mean: inkedCount ? sum / inkedCount : 0,
      bias: inkedCount ? Math.max(...signed.map(v => Math.abs(v / inkedCount))) : 0,
      touched: touched / pixels,
      ink: inkedCount / pixels,
      flatMean: flatSample ? flatSum / flatSample : 0,
      flatSample,
    };
  }

  /**
   * The gate as data: each budget a recorded case is held to, in the order the
   * suite asserts them, with the value the case read and the limit. `floor`
   * marks the one a case has to exceed rather than stay under. A skipped case is
   * held to nothing, and a measure an older manifest did not record is left out.
   */
  function gate(c) {
    if (c.skip || !c.budgets) {
      return [];
    }
    const b = c.budgets;
    const checks = [];
    const check = (measure, value, limit, floor = false) => {
      if (value !== undefined && limit !== undefined) {
        checks.push({ measure, value, limit, floor });
      }
    };
    check('ink', c.ink, INK_MIN_RATIO, true);
    check('quad', c.quad, b.quad);
    check('mean', c.mean, b.mean);
    check('bias', c.bias, b.bias);
    if (c.flatSample >= FLAT_MIN_SAMPLE) {
      check('flat', c.flat, b.flat);
    }
    if (b.diff !== null) {
      check('tile', c.tile, b.tile);
      check('diff', c.diff, b.diff);
    }
    return checks;
  }

  /** Whether a check holds. A NaN, which a manifest stores as null, fails as it does in expect. */
  function holds(g) {
    return typeof g.value === 'number' && (g.floor ? g.value > g.limit : g.value <= g.limit);
  }

  /** The checks a recorded case fails, none when it passes or is not gated. */
  function failures(c) {
    return gate(c).filter(g => !holds(g));
  }

  /** Each measure as the gallery labels it, and the decimals of the share ones, shown as percent. */
  const LABELS = {
    ink: 'ink',
    quad: 'worst block',
    mean: 'mean',
    bias: 'bias',
    flat: 'flat',
    tile: 'worst tile',
    diff: 'differing',
  };
  const PERCENT = { ink: 2, tile: 1, diff: 3 };

  /** A failed check in a few words, e.g. `bias 2.09, over the 2 allowed`. */
  function describe(g) {
    const share = PERCENT[g.measure];
    const value =
      typeof g.value !== 'number'
        ? 'not a number'
        : share === undefined
          ? g.value.toFixed(g.measure === 'quad' ? 1 : 2)
          : `${(g.value * 100).toFixed(share)}%`;
    const limit = share === undefined ? String(g.limit) : `${+(g.limit * 100).toFixed(2)}%`;
    return `${LABELS[g.measure]} ${value}, ${g.floor ? `under the ${limit} needed` : `over the ${limit} allowed`}`;
  }

  global.RenderMeasures = {
    FLAT_EPS,
    BLOCK_SCENE_PX,
    FLAT_MIN_SAMPLE,
    INK_MIN_RATIO,
    inked,
    spread,
    blockDelta,
    deltas,
    gate,
    holds,
    failures,
    describe,
  };
})(globalThis);
