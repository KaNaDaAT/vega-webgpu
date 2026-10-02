/**
 * Every name in the WebGPU vertex format list is its component type followed
 * by a bit width and an optional `xN`, so the width and the count come out of
 * the name rather than a table that has to be kept in step with it. The packed
 * formats break that rule, and nothing here uses them.
 */
function parts(format: GPUVertexFormat): readonly [bytes: number, count: number] {
  const match = /(8|16|32)(?:x([234]))?$/.exec(format);
  if (!match) {
    return [0, 0];
  }
  const count = Number(match[2] ?? 1);
  return [(Number(match[1]) / 8) * count, count];
}

/** Bytes one attribute of this format takes in a vertex buffer. */
export function formatSize(format: GPUVertexFormat): number {
  return parts(format)[0];
}

/** How many components one attribute of this format supplies to the shader. */
export function formatElementCount(format: GPUVertexFormat): number {
  return parts(format)[1];
}
