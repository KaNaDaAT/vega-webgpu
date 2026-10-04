/** An image as pngjs and ImageData both hold one: RGBA bytes, row by row. */
export interface MeasuredImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface ChannelStats {
  /**
   * Largest channel difference between block averages, over blocks of
   * `2 * dpi` pixels a side. See BLOCK_SCENE_PX.
   */
  quad: number;
  /** Mean channel difference over pixels either side inked. */
  mean: number;
  /** Fraction of pixels at least one channel differs on. */
  touched: number;
  /** Fraction of pixels either render drew on. */
  ink: number;
  /**
   * Largest mean *signed* channel difference over inked pixels. A render that
   * is systematically off shifts every pixel the same way and shows up here,
   * where the unsigned mean cannot see it under the antialiasing noise that
   * text and thin lines carry.
   */
  bias: number;
  /** Mean channel difference over inked pixels away from any edge. */
  flatMean: number;
  /** How many pixels that average is over. Under a few hundred it says little. */
  flatSample: number;
}

/** A measure the suite gates on, by the name its manifest row uses. */
export type GateMeasure = 'ink' | 'quad' | 'mean' | 'bias' | 'flat' | 'tile' | 'diff';

/** One budget a case is held to, as `RenderMeasures.gate` lists them. */
export interface GateCheck {
  measure: GateMeasure;
  value: number;
  limit: number;
  /** The value has to exceed the limit rather than stay under it. */
  floor: boolean;
}

/** What the gate reads off a case: the measures a manifest row records and its budgets. */
export interface GatedCase {
  skip?: unknown;
  ink?: number;
  quad?: number;
  mean: number;
  bias?: number;
  flat: number;
  flatSample: number;
  tile: number;
  diff: number;
  budgets?: { diff: number | null; tile: number; mean: number; bias?: number; flat: number; quad?: number };
}

declare global {
  /** What test/measures.js puts on the global. */
  var RenderMeasures: {
    FLAT_EPS: number;
    BLOCK_SCENE_PX: number;
    FLAT_MIN_SAMPLE: number;
    INK_MIN_RATIO: number;
    inked(data: ArrayLike<number>, i: number): boolean;
    spread(img: MeasuredImage): Uint8Array;
    blockDelta(imgA: MeasuredImage, imgB: MeasuredImage, side: number): number;
    deltas(imgA: MeasuredImage, imgB: MeasuredImage, blockSide: number): ChannelStats;
    gate(c: GatedCase): GateCheck[];
    holds(g: GateCheck): boolean;
    failures(c: GatedCase): GateCheck[];
    describe(g: GateCheck): string;
  };
}
