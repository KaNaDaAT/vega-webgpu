/**
 * The comparison both pages are built on. The demo compares two live renderers
 * and the gallery compares two pngs a test run left on disk, but past the point
 * where pixels exist those are the same problem, so the measuring and the diff
 * painting live here rather than twice.
 *
 * Plain script, no module, since both pages load it with a script tag.
 */
(function (global) {
  /** Composites `el` over white at its own size, so a transparent backing store compares fairly. */
  function readCanvas(el) {
    if (!el) {
      throw new Error('there is no canvas to read, so the view never drew or was already torn down');
    }
    const scratch = document.createElement('canvas');
    scratch.width = el.width;
    scratch.height = el.height;
    const c2d = scratch.getContext('2d', { willReadFrequently: true });
    c2d.fillStyle = 'white';
    c2d.fillRect(0, 0, scratch.width, scratch.height);
    c2d.drawImage(el, 0, 0);
    return c2d.getImageData(0, 0, scratch.width, scratch.height);
  }

  /** The same, for a loaded image. */
  function readImage(img) {
    const scratch = document.createElement('canvas');
    scratch.width = img.naturalWidth;
    scratch.height = img.naturalHeight;
    const c2d = scratch.getContext('2d', { willReadFrequently: true });
    c2d.fillStyle = 'white';
    c2d.fillRect(0, 0, scratch.width, scratch.height);
    c2d.drawImage(img, 0, 0);
    return c2d.getImageData(0, 0, scratch.width, scratch.height);
  }

  /** A webgpu view's frame, read off the gpu and composited over white. */
  async function readRenderer(view) {
    const shot = await view._renderer.captureFrame();
    const out = new ImageData(shot.width, shot.height);
    for (let i = 0; i < shot.data.length; i += 4) {
      const alpha = shot.data[i + 3] / 255;
      for (let c = 0; c < 3; c++) {
        out.data[i + c] = Math.round(shot.data[i + c] * alpha + 255 * (1 - alpha));
      }
      out.data[i + 3] = 255;
    }
    return out;
  }

  /** `#rrggbb` as r, g, b. */
  function parseColor(hex) {
    const h = String(hex).replace('#', '');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0);
  }

  /** Green through yellow to red, for `t` in 0 to 1. */
  function ramp(t) {
    const x = Math.max(0, Math.min(1, t));
    return x < 0.5 ? [Math.round(2 * x * 255), 200, 40] : [230, Math.round(200 * (1 - (x - 0.5) * 2)), 40];
  }

  const { BLOCK_SCENE_PX, FLAT_EPS, deltas, inked, spread } = global.RenderMeasures;

  /**
   * The gated measures, so the live view can say what the recorded one says.
   * They are RenderMeasures', which compare.ts gates on, so a number here means
   * the same thing as a number there.
   */
  function gatedMeasures(left, right, blockSide) {
    const side = Math.max(1, Math.round(blockSide || BLOCK_SCENE_PX));
    const { bias, quad, ink } = deltas(left, right, side);
    return { bias, quad, inked: Math.round(ink * left.width * left.height), ink };
  }

  /**
   * Paints what the two disagree on, and measures how far apart they are.
   *
   * `scope` picks which pixels count. `all` is every pixel, which is what the
   * eye sees. `flat` keeps only pixels whose 3x3 neighbourhood is flat in both,
   * which drops every edge and leaves mark interiors, so what it reports is the
   * colour rather than the coverage. The render suite gates on both for the same
   * reason: an edge landing on the other side of a rounding boundary is not a
   * defect, and a mark filled with the wrong colour is.
   */
  function diffImages(left, right, options) {
    const opts = options ?? {};
    const threshold = Math.max(0, Number(opts.threshold) || 0);
    const style = opts.style ?? 'mask';
    const scope = opts.scope ?? 'all';
    const [markR, markG, markB] = parseColor(opts.color ?? '#e4572e');

    if (left.width !== right.width || left.height !== right.height) {
      return {
        error: `size mismatch: canvas ${left.width}x${left.height}, webgpu ${right.width}x${right.height}`,
      };
    }

    const out = new ImageData(left.width, left.height);
    // over lays the marks on the webgpu render, so a difference is placed
    // against what was actually drawn rather than against nothing
    if (style === 'over') {
      out.data.set(right.data);
    }

    const flatL = scope === 'flat' ? spread(left) : null;
    const flatR = scope === 'flat' ? spread(right) : null;

    // the magnitudes come first, so the ramp can span what is actually there
    const delta = new Uint8Array(left.data.length / 4);
    const counted = new Uint8Array(left.data.length / 4);
    let differing = 0;
    let shown = 0;
    let worst = 0;
    let inkedCount = 0;
    let sum = 0;
    for (let i = 0, p = 0; i < left.data.length; i += 4, p++) {
      let d = 0;
      for (let c = 0; c < 3; c++) {
        d = Math.max(d, Math.abs(left.data[i + c] - right.data[i + c]));
      }
      const scoped = scope === 'all' || (flatL[p] <= FLAT_EPS && flatR[p] <= FLAT_EPS);
      counted[p] = scoped ? 1 : 0;
      if (!scoped) {
        continue;
      }
      delta[p] = d;
      if (d > worst) worst = d;
      if (d > 0) differing++;
      if (d > threshold) shown++;
      if (inked(left.data, i) || inked(right.data, i)) {
        inkedCount++;
        sum += d;
      }
    }

    const span = Math.max(worst - threshold, 1);
    for (let i = 0, p = 0; i < left.data.length; i += 4, p++) {
      const d = delta[p];
      if (!counted[p] || d <= threshold) {
        continue;
      }
      if (style === 'heat') {
        // green at the threshold through to red at the worst pixel here, so the
        // ramp says how bad this comparison is rather than how bad one could be
        const [r, g, b] = ramp((d - threshold) / span);
        out.data[i] = r;
        out.data[i + 1] = g;
        out.data[i + 2] = b;
        out.data[i + 3] = 255;
      } else if (style === 'over') {
        out.data[i] = markR;
        out.data[i + 1] = markG;
        out.data[i + 2] = markB;
        out.data[i + 3] = 255;
      } else {
        out.data[i] = markR;
        out.data[i + 1] = markG;
        out.data[i + 2] = markB;
        out.data[i + 3] = Math.min(255, 60 + d * 3);
      }
    }

    const total = left.width * left.height;
    const mean = inkedCount ? sum / inkedCount : 0;
    const scale = style === 'heat' ? `, green ${threshold} to red ${worst}` : '';
    const where = scope === 'flat' ? ' away from any edge' : '';
    return {
      image: out,
      width: left.width,
      height: left.height,
      shown,
      differing,
      worst,
      mean,
      inked: inkedCount,
      total,
      summary:
        `${shown.toLocaleString()} pixels${where} differ by more than ${threshold} ` +
        `(${((100 * shown) / total).toFixed(3)}%), ${differing.toLocaleString()} differ at all, ` +
        `worst channel ${worst}, mean ${mean.toFixed(2)} over ${inkedCount.toLocaleString()} inked${scale}`,
    };
  }

  /**
   * Up and down walk the list, ctrl or cmd with them scrolls it instead.
   *
   * Walking is what the keys are for here, since both pages are a list of a
   * hundred odd cases and the point is to step through them looking at the
   * pixels. Scrolling without moving the selection is the rarer thing, so it
   * takes the modifier. j and k do the same as the arrows.
   */
  function bindListKeys({ list, keyOf, current, pick, step = 140 }) {
    window.addEventListener('keydown', e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }
      const down = e.key === 'ArrowDown' || e.key === 'j';
      const up = e.key === 'ArrowUp' || e.key === 'k';
      if ((!down && !up) || e.altKey || e.shiftKey) {
        return;
      }
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        list.scrollBy({ top: down ? step : -step, behavior: 'smooth' });
        return;
      }
      const rows = [...list.children].map(keyOf).filter(k => k !== undefined && k !== null);
      if (!rows.length) {
        return;
      }
      const at = rows.indexOf(current());
      const to = Math.max(0, Math.min(rows.length - 1, at + (down ? 1 : -1)));
      if (rows[to] !== undefined && to !== at) {
        pick(rows[to]);
      }
    });
  }

  global.RenderCompare = {
    bindListKeys,
    readCanvas,
    readImage,
    readRenderer,
    diffImages,
    parseColor,
    ramp,
    spread,
    FLAT_EPS,
    gatedMeasures,
  };
})(window);
