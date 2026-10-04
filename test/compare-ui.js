/**
 * The controls both pages read a pair through: the wipe divider, the blink rate
 * and the pressed state of a row of buttons. compare-core.js measures and
 * paints the diff, and this only wires the controls.
 *
 * Plain script, no module, since both pages load it with a script tag.
 */
(function (global) {
  /**
   * What the readout says for a divider at `at` percent. The slider is where
   * the divider sits, so its ends are not "all canvas" and "all webgpu" the way
   * two labels either side of it would suggest.
   */
  function wipeLabel(at) {
    return at === 0 ? 'all webgpu' : at === 100 ? 'all canvas' : `canvas ${Math.round(at)}%`;
  }

  /** Puts `overlay()`'s divider and the readout where the slider is, now and on every move. */
  function bindWipe(slider, readout, overlay) {
    const set = () => {
      const at = Number(slider.value);
      overlay()?.style.setProperty('--wipe', `${at}%`);
      readout.textContent = wipeLabel(at);
    };
    slider.addEventListener('input', set);
    set();
    return set;
  }

  /**
   * Keeps `overlay()` blinking at the rate control's speed. A stated preference
   * for less motion picks the slowest rate rather than overriding one, since
   * blink is asked for and its speed is a control.
   */
  function bindBlink(rate, overlay) {
    if (global.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      rate.value = '4s';
    }
    const set = () => overlay()?.style.setProperty('--blink', rate.value);
    rate.addEventListener('change', set);
    set();
    return set;
  }

  /** Marks the button whose `data-<key>` is `value` as the pressed one. */
  function markPressed(container, key, value) {
    for (const b of container.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset[key] === value));
    }
  }

  global.CompareUI = { wipeLabel, bindWipe, bindBlink, markPressed };
})(window);
