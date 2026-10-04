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

  global.RenderMeasures = { FLAT_EPS, BLOCK_SCENE_PX, inked, spread, blockDelta, deltas };
})(globalThis);
