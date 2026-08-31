import { PNG } from 'pngjs';

/**
 * What the harness returns. The WebGPU renderer hands back raw RGBA read off
 * the GPU, because a headless runner never composites and both element
 * screenshots and toDataURL come back blank there. The canvas renderer has no
 * such path and returns a data URL.
 */
export interface Shot {
  dataUrl?: string;
  rawB64?: string;
  width?: number;
  height?: number;
}

/** Encodes a harness snapshot as PNG bytes. */
export function shotToPng(shot: Shot): Buffer {
  if (shot.rawB64 && shot.width && shot.height) {
    const img = new PNG({ width: shot.width, height: shot.height });
    img.data = Buffer.from(shot.rawB64, 'base64');
    return PNG.sync.write(img);
  }
  return Buffer.from((shot.dataUrl ?? '').split(',')[1] ?? '', 'base64');
}
