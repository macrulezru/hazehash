import { readFile } from 'node:fs/promises';
import { encode } from './encode';
import { toBase64Url } from './encoder/base64';
import { loadSharp } from './sharp';
import type { EncodeOptions } from './types';

export type { EncodeOptions } from './types';

export interface EncodedFile {
  /** The hash bytes. */
  bytes: Uint8Array;
  /** The hash as base64url. */
  hash: string;
  /** Pixel size of the image as displayed (after EXIF orientation). */
  width: number;
  height: number;
}

/**
 * Encodes an image file (path or encoded bytes) and also reports its size.
 * Requires the optional `sharp`. The image is converted to sRGB and rotated according to its
 * EXIF orientation, so the hash matches what a browser displays.
 */
export async function encodeFileDetailed(
  pathOrBuffer: string | Uint8Array,
  options?: EncodeOptions,
): Promise<EncodedFile> {
  const sharp = await loadSharp();
  const input = typeof pathOrBuffer === 'string' ? await readFile(pathOrBuffer) : pathOrBuffer;
  const { data, info } = await sharp(input)
    .rotate()
    .toColorspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bytes = encode({ data, width: info.width, height: info.height }, options);
  return { bytes, hash: toBase64Url(bytes), width: info.width, height: info.height };
}

/** Encodes an image file (path or encoded bytes) into a hash. Requires the optional `sharp`. */
export async function encodeFile(
  pathOrBuffer: string | Uint8Array,
  options?: EncodeOptions,
): Promise<Uint8Array> {
  return (await encodeFileDetailed(pathOrBuffer, options)).bytes;
}

export async function encodeFileToString(
  pathOrBuffer: string | Uint8Array,
  options?: EncodeOptions,
): Promise<string> {
  return (await encodeFileDetailed(pathOrBuffer, options)).hash;
}
