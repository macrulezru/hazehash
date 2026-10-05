/** Input preparation: area-average downscale in linear light, then conversion to OKLab. */
import { linearToOklab, srgb8ToLinear } from './color';
import type { RgbaImage } from '../types';

export interface Prepared {
  /** Analysis size. */
  width: number;
  height: number;
  /** OKLab and alpha (0–1) planes of size width·height. */
  L: Float64Array;
  a: Float64Array;
  b: Float64Array;
  A: Float64Array;
  minAlpha: number;
}

export function analysisDims(W: number, H: number, analysisSize: number): [number, number] {
  const long = Math.max(W, H);
  if (long <= analysisSize) return [W, H];
  const scale = analysisSize / long;
  if (W >= H) return [analysisSize, Math.min(H, Math.max(8, Math.round(H * scale)))];
  return [Math.min(W, Math.max(8, Math.round(W * scale))), analysisSize];
}

interface Axis {
  t0: Int32Array;
  w0: Float64Array;
  t1: Int32Array;
  w1: Float64Array;
}

/** For each source pixel: up to two target cells and overlap lengths. */
function axisWeights(src: number, dst: number): Axis {
  const t0 = new Int32Array(src);
  const t1 = new Int32Array(src);
  const w0 = new Float64Array(src);
  const w1 = new Float64Array(src);
  const scale = dst / src;
  for (let x = 0; x < src; x++) {
    const a = x * scale;
    const b = (x + 1) * scale;
    const c0 = Math.min(Math.floor(a), dst - 1);
    t0[x] = c0;
    w0[x] = Math.max(0, Math.min(b, c0 + 1) - a);
    if (b > c0 + 1 + 1e-12 && c0 + 1 < dst) {
      t1[x] = c0 + 1;
      w1[x] = b - (c0 + 1);
    } else {
      t1[x] = c0;
      w1[x] = 0;
    }
  }
  return { t0, w0, t1, w1 };
}

export function prepare(image: RgbaImage, analysisSize: number): Prepared {
  const { data, width: W, height: H } = image;
  const [Wa, Ha] = analysisDims(W, H, analysisSize);
  const n = Wa * Ha;
  // Accumulators: premultiplied linear R, G, B and A.
  const acc = new Float64Array(n * 4);
  const ax = axisWeights(W, Wa);
  const ay = axisWeights(H, Ha);

  for (let y = 0; y < H; y++) {
    const ry0 = ay.t0[y];
    const wy0 = ay.w0[y];
    const ry1 = ay.t1[y];
    const wy1 = ay.w1[y];
    let p = y * W * 4;
    for (let x = 0; x < W; x++, p += 4) {
      const A = data[p + 3] / 255;
      const pr = srgb8ToLinear(data[p]) * A;
      const pg = srgb8ToLinear(data[p + 1]) * A;
      const pb = srgb8ToLinear(data[p + 2]) * A;
      const cx0 = ax.t0[x];
      const wx0 = ax.w0[x];
      const cx1 = ax.t1[x];
      const wx1 = ax.w1[x];
      add(acc, (ry0 * Wa + cx0) * 4, wy0 * wx0, pr, pg, pb, A);
      if (wx1 > 0) add(acc, (ry0 * Wa + cx1) * 4, wy0 * wx1, pr, pg, pb, A);
      if (wy1 > 0) {
        add(acc, (ry1 * Wa + cx0) * 4, wy1 * wx0, pr, pg, pb, A);
        if (wx1 > 0) add(acc, (ry1 * Wa + cx1) * 4, wy1 * wx1, pr, pg, pb, A);
      }
    }
  }

  // Alpha-weighted mean color of the whole image (fills nearly transparent pixels).
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sa = 0;
  for (let i = 0; i < n; i++) {
    sr += acc[i * 4];
    sg += acc[i * 4 + 1];
    sb += acc[i * 4 + 2];
    sa += acc[i * 4 + 3];
  }
  const avg = [0.5, 0, 0];
  if (sa > 1e-9) linearToOklab(sr / sa, sg / sa, sb / sa, avg);

  const L = new Float64Array(n);
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const A = new Float64Array(n);
  const lab = [0, 0, 0];
  let minAlpha = 1;
  for (let i = 0; i < n; i++) {
    const alpha = Math.min(1, acc[i * 4 + 3]);
    A[i] = alpha;
    if (alpha < minAlpha) minAlpha = alpha;
    if (acc[i * 4 + 3] >= 1 / 255) {
      const inv = 1 / acc[i * 4 + 3];
      linearToOklab(acc[i * 4] * inv, acc[i * 4 + 1] * inv, acc[i * 4 + 2] * inv, lab);
      L[i] = lab[0];
      a[i] = lab[1];
      b[i] = lab[2];
    } else {
      L[i] = avg[0];
      a[i] = avg[1];
      b[i] = avg[2];
    }
  }
  return { width: Wa, height: Ha, L, a, b, A, minAlpha };
}

function add(
  acc: Float64Array,
  o: number,
  w: number,
  pr: number,
  pg: number,
  pb: number,
  A: number,
): void {
  acc[o] += w * pr;
  acc[o + 1] += w * pg;
  acc[o + 2] += w * pb;
  acc[o + 3] += w * A;
}
