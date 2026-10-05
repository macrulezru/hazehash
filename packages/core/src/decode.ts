import { synthesize } from './basis';
import { asBytes, toBytes } from './base64';
import { BitReader, readRice } from './bits';
import { linearToSrgb, oklabToGamutLinear } from './color';
import { codeToAspect, headerSize, outputSize, readHeader, type Header } from './format';
import { buildOrder, gridOf, type Channel } from './layout';
import { clamp, dcDequantize, dequantizeAc, scaleOf } from './quant';
import type { DecodeOptions, RgbaImage } from './types';

export type { DecodeOptions, RgbaImage } from './types';

export { toBytes };
export { PlaceholderError } from './errors';
export type { PlaceholderErrorCode } from './errors';

export function getAspectRatio(hash: string | Uint8Array): number {
  return codeToAspect(readHeader(asBytes(hash)).aspectCode);
}

export function getAverageColor(hash: string | Uint8Array): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  const h = readHeader(asBytes(hash));
  const rgb = [0, 0, 0];
  oklabToGamutLinear(
    clamp(dcDequantize(0, h.dc[0]), 0, 1),
    dcDequantize(1, h.dc[1]),
    dcDequantize(2, h.dc[2]),
    rgb,
  );
  const [r, g, b] = rgb.map((v) => Math.round(clamp(linearToSrgb(v), 0, 1) * 255));
  return { r, g, b, a: h.alpha ? dcDequantize(3, h.dc[3]) : 1 };
}

/** Reconstructed channel coefficients: c[ch][j·nx + i]. */
function readCoefficients(bytes: Uint8Array, h: Header): Float64Array[] {
  const grids = h; // a header carries the same grid fields as Grids
  const channels: Channel[] = h.alpha ? [0, 1, 2, 3] : [0, 1, 2];
  const coefs: Float64Array[] = [];
  for (const ch of channels) {
    const [nx, ny] = gridOf(grids, ch);
    const c = new Float64Array(nx * ny);
    c[0] = dcDequantize(ch, h.dc[ch]);
    coefs[ch] = c;
  }
  const scales = channels.map((ch) => scaleOf(ch, h.scale[ch]));
  const reader = new BitReader(bytes, headerSize(h.alpha));
  for (const e of buildOrder(grids)) {
    let q = readRice(reader, h.k[e.ch]);
    q = q > e.qmax ? e.qmax : q < -e.qmax ? -e.qmax : q;
    coefs[e.ch][e.j * e.nx + e.i] = dequantizeAc(q, scales[e.ch], e.qmax);
  }
  return coefs;
}

export function decode(hash: string | Uint8Array, options: DecodeOptions = {}): RgbaImage {
  const bytes = asBytes(hash);
  const h = readHeader(bytes);
  const size = Math.round(clamp(options.size ?? 32, 4, 128));
  const dither = options.dither ?? true;
  const [Wo, Ho] = outputSize(codeToAspect(h.aspectCode), size);
  const coefs = readCoefficients(bytes, h);
  const grids = h;

  const n = Wo * Ho;
  const planes: Float64Array[] = [];
  for (let ch = 0; ch < coefs.length; ch++) {
    const [nx, ny] = gridOf(grids, ch as Channel);
    const plane = new Float64Array(n);
    synthesize(coefs[ch], nx, nx, ny, Wo, Ho, plane);
    planes.push(plane);
  }

  const data = new Uint8ClampedArray(n * 4);
  const rgb = [0, 0, 0];
  for (let y = 0; y < Ho; y++) {
    for (let x = 0; x < Wo; x++) {
      const p = y * Wo + x;
      oklabToGamutLinear(clamp(planes[0][p], 0, 1), planes[1][p], planes[2][p], rgb);
      const u = dither ? fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y)) : 0.5;
      const o = p * 4;
      for (let c = 0; c < 3; c++) {
        const v = linearToSrgb(rgb[c]) * 255;
        data[o + c] = clamp(Math.floor(v + u), 0, 255);
      }
      data[o + 3] = h.alpha ? Math.round(clamp(planes[3][p], 0, 1) * 255) : 255;
    }
  }
  return { width: Wo, height: Ho, data };
}

function fract(v: number): number {
  return v - Math.floor(v);
}
