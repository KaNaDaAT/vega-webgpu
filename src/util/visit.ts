interface ZOrdered {
  zindex?: number;
  index?: number;
}

interface ZOrderedScene<T extends ZOrdered> {
  items?: T[];
  zdirty?: boolean;
  zitems?: T[];
}

function compare(a: ZOrdered, b: ZOrdered): number {
  return (a.zindex ?? 0) - (b.zindex ?? 0) || (a.index ?? 0) - (b.index ?? 0);
}

function zorder<T extends ZOrdered>(scene: ZOrderedScene<T>): T[] | undefined {
  if (!scene.zdirty) {
    return scene.zitems;
  }

  const items = scene.items ?? [];
  const output: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.index = i;
    if (item.zindex) {
      output.push(item);
    }
  }

  scene.zdirty = false;
  return (scene.zitems = output.sort(compare));
}

/** Visits scene items in paint order, honoring per-item zindex. */
export function visit<T extends ZOrdered>(scene: ZOrderedScene<T>, visitor: (item: T) => void): void {
  let items = scene.items;
  if (!items || !items.length) {
    return;
  }

  const zitems = zorder(scene);

  if (zitems && zitems.length) {
    for (let i = 0; i < items.length; i++) {
      if (!items[i].zindex) {
        visitor(items[i]);
      }
    }
    items = zitems;
  }

  for (let i = 0; i < items.length; i++) {
    visitor(items[i]);
  }
}
