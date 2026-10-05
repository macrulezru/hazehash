/** Header layout (reading side), aspect ratio code and output size. */
import { BitReader } from './bits';
import { PlaceholderError } from './errors';

export const HEADER_BYTES = 7;
export const HEADER_BYTES_ALPHA = 9;
export const MAX_HASH_BYTES = 1024;

export interface Header {
  aspectCode: number;
  alpha: boolean;
  Lx: number;
  Ly: number;
  Cx: number;
  Cy: number;
  Ax: number;
  Ay: number;
  /** Quantized DC of channels L, a, b, A. */
  dc: [number, number, number, number];
  /** Scale codes of channels L, a, b, A. */
  scale: [number, number, number, number];
  /** Rice parameters of channels L, a, b, A. */
  k: [number, number, number, number];
}

export function headerSize(alpha: boolean): number {
  return alpha ? HEADER_BYTES_ALPHA : HEADER_BYTES;
}

export function codeToAspect(code: number): number {
  return Math.pow(2, (code - 32) / 8);
}

/** Decoder output size for long side `size` and aspect ratio r. */
export function outputSize(r: number, size: number): [number, number] {
  return r >= 1
    ? [size, Math.max(1, Math.round(size / r))]
    : [Math.max(1, Math.round(size * r)), size];
}

/** Parses the header only; the AC stream is not read. */
export function readHeader(bytes: Uint8Array): Header {
  if (bytes.length < HEADER_BYTES || bytes.length > MAX_HASH_BYTES) {
    throw new PlaceholderError('InvalidLength');
  }
  const r = new BitReader(bytes);
  const ver = r.bits(2);
  if (ver !== 0) throw new PlaceholderError('UnsupportedVersion');
  const alpha = r.bit() === 1;
  if (alpha && bytes.length < HEADER_BYTES_ALPHA) {
    throw new PlaceholderError('InvalidLength');
  }
  const h: Header = {
    aspectCode: r.bits(6),
    alpha,
    Lx: r.bits(3) + 1,
    Ly: r.bits(3) + 1,
    Cx: r.bits(2) + 1,
    Cy: r.bits(2) + 1,
    Ax: 1,
    Ay: 1,
    dc: [0, 0, 0, 0],
    scale: [0, 0, 0, 0],
    k: [0, 0, 0, 0],
  };
  for (let c = 0; c < 3; c++) h.dc[c] = r.bits(6);
  for (let c = 0; c < 3; c++) h.scale[c] = r.bits(4);
  for (let c = 0; c < 3; c++) h.k[c] = r.bits(2);
  r.bit(); // reserved
  if (alpha) {
    h.dc[3] = r.bits(5);
    h.Ax = r.bits(2) + 1;
    h.Ay = r.bits(2) + 1;
    h.scale[3] = r.bits(4);
    h.k[3] = r.bits(2);
  }
  return h;
}
