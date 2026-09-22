import type { GPUVegaScene } from '../types/context.js';
import type { SceneItem } from '../types/scene.js';

/** Marks whose canvas draw translates to each item and back by the negated offset. */
const PER_ITEM = new Set(['arc', 'shape', 'symbol', 'path']);

/** The vertical translation canvas's rasterizer holds, per text mark, in device pixels. */
export type TextDrift = Map<GPUVegaScene, number>;

/** vega's own draw order: no zindex keeps the list, otherwise those come last. */
function ordered<T extends { zindex?: number }>(items: readonly T[]): readonly T[] {
  if (!items.some(item => item.zindex)) {
    return items;
  }
  const plain = items.filter(item => !item.zindex);
  const zed = items
    .map((item, index) => ({ item, index }))
    .filter(entry => entry.item.zindex)
    .sort((a, b) => (a.item.zindex as number) - (b.item.zindex as number) || a.index - b.index)
    .map(entry => entry.item);
  return [...plain, ...zed];
}

/**
 * The translation canvas's rasterizer actually holds when each text mark draws,
 * against the one it reports, in device pixels.
 *
 * Chrome keeps a canvas matrix in float32 and reports it back as a double, and
 * vega's canvas renderer translates to every arc, shape, symbol and path item
 * and back again by the negated offset. Those cancel on paper and not in
 * float32, so the matrix drifts further from the reported one with every item
 * drawn: about 2.7e-4 of a pixel over the 2260 symbols of the `label` spec.
 *
 * That is nothing anywhere except across a tie. Canvas rounds a text baseline
 * to a whole device pixel and rounds an exact half up, so a baseline landing on
 * .5 goes up undrifted and down drifted, and the label moves a whole row. Four
 * labels in `label` sit on exactly .5 and all four are a row out.
 *
 * Walking the scene the way that renderer does and accumulating the same
 * float32 translation reproduces the number exactly: 10.999725341796875 where
 * the reported matrix says 11, which is what puts The Godfather on row 14
 * rather than 15.
 *
 * Returns null when the scene holds something this does not model, which today
 * is a rotated item: vega rotates and unrotates around those, and that perturbs
 * the whole matrix rather than its translation. Placing text exactly is a
 * better answer than placing it by a drift we got wrong.
 */
export function canvasTextDrift(root: GPUVegaScene, origin: readonly number[], ratio: number): TextDrift | null {
  const out: TextDrift = new Map();
  const scale = Math.fround(ratio);
  let fy = Math.fround(origin[1] * ratio);
  let modelled = true;

  const move = (y: number): void => {
    fy = Math.fround(fy + Math.fround(Math.fround(y) * scale));
  };

  const walk = (mark: GPUVegaScene): void => {
    if (!modelled) {
      return;
    }
    const items = (mark.items ?? []) as SceneItem[];
    if (items.length === 0) {
      return;
    }
    // A clipped mark is drawn inside save and restore, so whatever its items
    // leave in the matrix is popped again with the clip.
    if (mark.clip) {
      const held = fy;
      walkMark(mark, items);
      fy = held;
      return;
    }
    walkMark(mark, items);
  };

  const walkMark = (mark: GPUVegaScene, items: SceneItem[]): void => {
    if (mark.marktype === 'text') {
      out.set(mark, fy);
      return;
    }
    if (mark.marktype === 'group') {
      for (const group of ordered(items) as (SceneItem & { items?: GPUVegaScene[] })[]) {
        const held = fy;
        move(group.y || 0);
        for (const child of ordered(group.items ?? [])) {
          walk(child);
        }
        // a group is drawn inside save and restore, so its own offset cancels
        fy = held;
      }
      return;
    }
    if (!PER_ITEM.has(mark.marktype)) {
      return;
    }
    for (const item of ordered(items) as (SceneItem & { angle?: number; opacity?: number })[]) {
      // vega returns before the translate on a transparent item, so it leaves
      // nothing behind
      if (item.opacity === 0) {
        continue;
      }
      if (item.angle) {
        modelled = false;
        return;
      }
      const y = item.y || 0;
      move(y);
      move(-y);
    }
  };

  walk(root);
  return modelled ? out : null;
}
