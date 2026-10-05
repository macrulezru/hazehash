import { readFile } from 'node:fs/promises';
import { encode } from './encode';
import { PlaceholderError } from './errors';
import { toBase64Url } from './encoder/base64';
import type { EncodeOptions } from './types';

export type { EncodeOptions } from './types';

interface SharpLike {
  (input: string | Uint8Array): {
    toColorspace(space: string): ReturnType<SharpLike>;
    ensureAlpha(): ReturnType<SharpLike>;
    raw(): ReturnType<SharpLike>;
    toBuffer(options: { resolveWithObject: true }): Promise<{
      data: Uint8Array;
      info: { width: number; height: number };
    }>;
  };
}

async function loadSharp(): Promise<SharpLike> {
  try {
    const mod = (await import('sharp')) as unknown as { default?: SharpLike } & SharpLike;
    return (mod.default ?? mod) as SharpLike;
  } catch {
    throw new PlaceholderError(
      'InvalidInput',
      'the optional dependency "sharp" is required to decode image files (npm i sharp)',
    );
  }
}

/** Encodes an image file (path or encoded bytes) into a hash. Requires the optional `sharp`. */
export async function encodeFile(
  pathOrBuffer: string | Uint8Array,
  options?: EncodeOptions,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const input = typeof pathOrBuffer === 'string' ? await readFile(pathOrBuffer) : pathOrBuffer;
  const { data, info } = await sharp(input)
    .toColorspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encode({ data, width: info.width, height: info.height }, options);
}

export async function encodeFileToString(
  pathOrBuffer: string | Uint8Array,
  options?: EncodeOptions,
): Promise<string> {
  return toBase64Url(await encodeFile(pathOrBuffer, options));
}
