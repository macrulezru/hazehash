/** Dequantization shared by the decoder and the encoder. */
import type { Channel } from './layout';
import { PARAMS } from './params';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dcDequantize(ch: Channel, q: number): number {
  if (ch === 0) return q / 63;
  if (ch === 3) return q / 31;
  return (q * 0.64) / 63 - 0.32;
}

/** 2^(-(15 - code) / 3) for each 4-bit scale code. */
const SCALE_STEP = Array.from({ length: 16 }, (_, code) => Math.pow(2, -(15 - code) / 3));

/** Channel scale from its 4-bit code. */
export function scaleOf(ch: Channel, code: number): number {
  const smax = ch === 1 || ch === 2 ? PARAMS.smaxC : PARAMS.smaxL;
  return smax * SCALE_STEP[code];
}

export function dequantizeAc(q: number, s: number, qmax: number): number {
  if (q === 0) return 0;
  const r = (Math.abs(q) - PARAMS.reconOffset) / qmax;
  const v = s * r * r;
  return q < 0 ? -v : v;
}
