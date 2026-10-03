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
    return joinChunks(chunks, total);
  }
}

/**
 * The chunks in one array, or null when they hold nothing. It is uploaded
 * straight away, so a lone chunk goes up as it is.
 */
export function joinChunks(
  chunks: ArrayLike<number>[],
  total = chunks.reduce((sum, chunk) => sum + chunk.length, 0),
): Float32Array | null {
  if (total === 0) {
    return null;
  }
  const filled = chunks.filter(chunk => chunk.length > 0);
  if (filled.length === 1 && filled[0] instanceof Float32Array) {
    return filled[0];
  }
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of filled) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
