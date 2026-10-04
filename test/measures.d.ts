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

declare global {
  /** What test/measures.js puts on the global. */
  var RenderMeasures: {
    FLAT_EPS: number;
    BLOCK_SCENE_PX: number;
    inked(data: ArrayLike<number>, i: number): boolean;
    spread(img: MeasuredImage): Uint8Array;
    blockDelta(imgA: MeasuredImage, imgB: MeasuredImage, side: number): number;
    deltas(imgA: MeasuredImage, imgB: MeasuredImage, blockSide: number): ChannelStats;
  };
}
