/**
 * A Map that holds at most `max` entries and drops the least recently used one
 * past that. Reading an entry counts as using it. `onEvict` is handed what is
 * dropped, for a cache whose values hold GPU memory.
 */
export class LruMap<K, V> extends Map<K, V> {
  constructor(
    private readonly max: number,
    private readonly onEvict?: (value: V, key: K) => void,
  ) {
    super();
  }

  override get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      // re-inserted, which keeps the map in least recently used order
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }

  override set(key: K, value: V): this {
    super.delete(key);
    super.set(key, value);
    if (this.size > this.max) {
      const [oldest, dropped] = this.entries().next().value as [K, V];
      super.delete(oldest);
      this.onEvict?.(dropped, oldest);
    }
    return this;
  }
}

/** Keeps `value` as one variant of `key`, such as one flatness a path is traced at. */
export function setVariant<V>(cache: LruMap<string, Map<string, V>>, key: string, variant: string, value: V): void {
  const variants = cache.get(key);
  if (variants) {
    variants.set(variant, value);
  } else {
    cache.set(key, new Map([[variant, value]]));
  }
}
