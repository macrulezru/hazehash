import { decode } from './decode';
import type { DecodeOptions } from './types';

export type { DecodeOptions } from './types';

/** Minimal canvas surface shared by HTMLCanvasElement and OffscreenCanvas. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): {
    putImageData(data: ImageData, x: number, y: number): void;
  } | null;
}

/** Decodes a hash into an ImageData object. */
export function toImageData(hash: string | Uint8Array, options?: DecodeOptions): ImageData {
  const img = decode(hash, options);
  // Copy into a plain ArrayBuffer-backed array: ImageData rejects other buffer kinds.
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

/** Draws the placeholder into a canvas, resizing the canvas to the decoded size. */
export function drawToCanvas(
  hash: string | Uint8Array,
  canvas: CanvasLike,
  options?: DecodeOptions,
): void {
  const data = toImageData(hash, options);
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')?.putImageData(data, 0, 0);
}
