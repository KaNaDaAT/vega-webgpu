export function formatElementCount(format: GPUVertexFormat): number {
  switch (format) {
    case 'float32':
    case 'uint32':
    case 'sint32':
      return 1;
    case 'uint8x2':
    case 'sint8x2':
    case 'unorm8x2':
    case 'snorm8x2':
    case 'uint16x2':
    case 'sint16x2':
    case 'unorm16x2':
    case 'snorm16x2':
    case 'float16x2':
    case 'float32x2':
    case 'uint32x2':
    case 'sint32x2':
      return 2;
    case 'float32x3':
    case 'uint32x3':
    case 'sint32x3':
      return 3;
    case 'uint8x4':
    case 'sint8x4':
    case 'unorm8x4':
    case 'snorm8x4':
    case 'uint16x4':
    case 'sint16x4':
    case 'unorm16x4':
    case 'snorm16x4':
    case 'float16x4':
    case 'float32x4':
    case 'uint32x4':
    case 'sint32x4':
      return 4;
    default:
      return 0; // Unsupported format
  }
}

export function formatSize(format: GPUVertexFormat): number {
  switch (format) {
    case 'float16x2':
      return 2 * 2;
    case 'float16x4':
      return 2 * 4;
    case 'float32':
      return Float32Array.BYTES_PER_ELEMENT;
    case 'float32x2':
      return Float32Array.BYTES_PER_ELEMENT * 2;
    case 'float32x3':
      return Float32Array.BYTES_PER_ELEMENT * 3;
    case 'float32x4':
      return Float32Array.BYTES_PER_ELEMENT * 4;
    case 'sint8x2':
    case 'snorm8x2':
      return Int8Array.BYTES_PER_ELEMENT * 2;
    case 'sint8x4':
    case 'snorm8x4':
      return Int8Array.BYTES_PER_ELEMENT * 4;
    case 'sint16x2':
    case 'snorm16x2':
      return Int16Array.BYTES_PER_ELEMENT * 2;
    case 'sint16x4':
    case 'snorm16x4':
      return Int16Array.BYTES_PER_ELEMENT * 4;
    case 'sint32':
      return Int32Array.BYTES_PER_ELEMENT;
    case 'sint32x2':
      return Int32Array.BYTES_PER_ELEMENT * 2;
    case 'sint32x3':
      return Int32Array.BYTES_PER_ELEMENT * 3;
    case 'sint32x4':
      return Int32Array.BYTES_PER_ELEMENT * 4;
    case 'uint32':
      return Uint32Array.BYTES_PER_ELEMENT;
    case 'uint32x2':
      return Uint32Array.BYTES_PER_ELEMENT * 2;
    case 'uint32x3':
      return Uint32Array.BYTES_PER_ELEMENT * 3;
    case 'uint32x4':
      return Uint32Array.BYTES_PER_ELEMENT * 4;

    case 'uint8x2':
    case 'unorm8x2':
      return Uint8Array.BYTES_PER_ELEMENT * 2;
    case 'uint8x4':
    case 'unorm8x4':
      return Uint8Array.BYTES_PER_ELEMENT * 4;
    case 'uint16x2':
    case 'unorm16x2':
      return Uint16Array.BYTES_PER_ELEMENT * 2;
    case 'uint16x4':
    case 'unorm16x4':
      return Uint16Array.BYTES_PER_ELEMENT * 4;
    case 'unorm10-10-10-2':
      return 4; // (10 + 10 + 10 + 2) / 8
    default:
      return 0;
  }
}
