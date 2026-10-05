import { decode as blurDecode, encode as blurEncode } from 'blurhash';
import { rgbaToThumbHash, thumbHashToRGBA } from 'thumbhash';
import { decode as hazeDecode } from '../../packages/core/src/decode';
import { encode as hazeEncode } from '../../packages/core/src/encode';
import type { EncodeOptions } from '../../packages/core/src/types';
import type { Raw } from './metrics';

export interface CodecResult {
  bytes: number;
  out: Raw;
  encMs: number;
  decMs: number;
}

export interface SourceImages {
  full: Raw;
  /** At most 100 px on the long side, for ThumbHash. */
  small100: Raw;
  /** At most 64 px on the long side, composited over white, for BlurHash. */
  small64: Raw;
}

function timed<T>(fn: () => T): [T, number] {
  const t = performance.now();
  const v = fn();
  return [v, performance.now() - t];
}

export function haze(src: SourceImages, budget: number, options: EncodeOptions = {}): CodecResult {
  const [bytes, encMs] = timed(() => hazeEncode(src.full, { budget, ...options }));
  const [out, decMs] = timed(() => hazeDecode(bytes, { size: 32 }));
  return { bytes: bytes.length, out, encMs, decMs };
}

export function thumb(src: SourceImages): CodecResult {
  const s = src.small100;
  const [hash, encMs] = timed(() => rgbaToThumbHash(s.width, s.height, s.data as Uint8Array));
  const [dec, decMs] = timed(() => thumbHashToRGBA(hash));
  const out = { width: dec.w, height: dec.h, data: dec.rgba };
  return { bytes: hash.length, out, encMs, decMs };
}

const LOG2_83 = Math.log2(83);

/** Largest BlurHash grid whose string carries at most `budget` bytes of information. */
export function blurGrid(budget: number, aspect: number): [number, number] {
  const maxLen = Math.floor((budget * 8) / LOG2_83);
  let best: [number, number] = [1, 1];
  let bestScore = [0, Infinity];
  for (let cx = 1; cx <= 9; cx++) {
    for (let cy = 1; cy <= 9; cy++) {
      if (4 + 2 * cx * cy > maxLen) continue;
      const dev = Math.abs(Math.log(cx / cy) - Math.log(aspect));
      if (cx * cy > bestScore[0] || (cx * cy === bestScore[0] && dev < bestScore[1])) {
        best = [cx, cy];
        bestScore = [cx * cy, dev];
      }
    }
  }
  return best;
}

export function blur(src: SourceImages, budget: number): CodecResult {
  const s = src.small64;
  const aspect = src.full.width / src.full.height;
  const [cx, cy] = blurGrid(budget, aspect);
  const [hash, encMs] = timed(() =>
    blurEncode(new Uint8ClampedArray(s.data), s.width, s.height, cx, cy),
  );
  const ow = aspect >= 1 ? 32 : Math.max(1, Math.round(32 * aspect));
  const oh = aspect >= 1 ? Math.max(1, Math.round(32 / aspect)) : 32;
  const [px, decMs] = timed(() => blurDecode(hash, ow, oh));
  const bytes = Math.ceil((hash.length * LOG2_83) / 8);
  return { bytes, out: { width: ow, height: oh, data: px }, encMs, decMs };
}
