import { needsBackdrop } from './blend.js';

/**
 * Items drawn together in one call, in paint order. A change of blend or of
 * `key` closes the run, since a blend belongs to the pipeline and a key to
 * whatever else the draw shares. So does an item whose blend needs the
 * backdrop, which meets the frame on its own the way canvas composites it.
 */
export class DrawRun<T> {
  private items: T[] = [];
  private blend = 'normal';
  private key: unknown;

  constructor(
    private readonly opaqueBackdrop: boolean,
    private readonly draw: (items: T[], blend: string) => void,
  ) {}

  add(item: T, blend: string, key?: unknown): void {
    if (this.items.length > 0 && (blend !== this.blend || key !== this.key)) {
      this.flush();
    }
    this.blend = blend;
    this.key = key;
    this.items.push(item);
    if (needsBackdrop(blend, this.opaqueBackdrop)) {
      this.flush();
    }
  }

  flush(): void {
    if (this.items.length > 0) {
      const items = this.items;
      this.items = [];
      this.draw(items, this.blend);
    }
  }
}
