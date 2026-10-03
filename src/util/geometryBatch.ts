/**
 * Values gathered from consecutive draws that share one pipeline, so they go
 * up as a single buffer and draw call. Appended in paint order, and held rather
 * than copied as they arrive, since spreading them into one array throws past
 * about 125 thousand values, which a line of seven thousand points reaches.
 */
export class GeometryBatch {
  private chunks: ArrayLike<number>[] = [];
  private total = 0;

  push(data: ArrayLike<number>): void {
    if (data.length > 0) {
      this.chunks.push(data);
      this.total += data.length;
    }
  }

  /** Every value pushed, in one array, or null when there were none. Resets the batch. */
  flush(): Float32Array | null {
    const { chunks, total } = this;
    this.chunks = [];
    this.total = 0;
    if (total === 0) {
      return null;
    }
    // it is uploaded straight away, so a lone chunk goes up as it is
    if (chunks.length === 1 && chunks[0] instanceof Float32Array) {
      return chunks[0];
    }
    const out = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}
