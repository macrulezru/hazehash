/**
 * Laboratory codec for ablation studies. It follows the production encoder (grid search, scale
 * codes, rate-distortion bisection, forced truncation) but lets individual design choices be
 * switched off, so their contribution can be measured. Output size is computed arithmetically;
 * the decoded picture is rebuilt directly from the quantized state. Opaque images only.
 */
import { AN, analyze } from '../../packages/core/src/encoder/analysis';
import { cosTable, synthesize } from '../../packages/core/src/basis';
import { linearToSrgb, oklabToGamutLinear } from '../../packages/core/src/color';
import { aspectToCode } from '../../packages/core/src/encoder/header';
import { riceLength, zigzag } from '../../packages/core/src/encoder/bits';
import { prepare } from '../../packages/core/src/encoder/prepare';
import { chooseScaleCode, dcQuantize, quantizeAc } from '../../packages/core/src/encoder/quant';
import { codeToAspect, outputSize } from '../../packages/core/src/format';
import type { Channel } from '../../packages/core/src/layout';
import { PARAMS } from '../../packages/core/src/params';
import { clamp, dcDequantize, dequantizeAc, scaleOf } from '../../packages/core/src/quant';
import type { RgbaImage } from '../../packages/core/src/types';
import type { Raw } from './metrics';

export interface Variant {
  /** Triangular coefficient mask or the full rectangle. */
  mask: 'tri' | 'rect';
  /** For the 'tri' mask: threshold in quarters, 4 is i/nx + j/ny < 1, 6 is < 1.5. */
  maskQuarters?: number;
  /** Golomb-Rice with per-channel k, or a fixed 4 bits per coefficient. */
  entropy: 'rice' | 'fixed4';
  /** Rate-distortion optimised quantization; off means plain rounding plus tail truncation. */
  rdo: boolean;
  /** Frequency-dependent Qmax bands, or one flat Qmax per channel. */
  qmax: 'banded' | 'flat';
  /** Separate grids for luma and chroma, or one shared grid. */
  grids: 'separate' | 'single';
  /** OKLab, or gamma-encoded sRGB in a Y'CbCr basis. */
  space: 'oklab' | 'ycbcr';
  /** Flat Qmax values (luma, chroma) when qmax is 'flat'. */
  flat?: [number, number];
}

/** The production format. */
export const BASELINE: Variant = {
  mask: 'tri',
  maskQuarters: 6,
  entropy: 'rice',
  rdo: true,
  qmax: 'flat',
  flat: [7, 3],
  grids: 'separate',
  space: 'oklab',
};

/** Frequency-dependent Qmax of the earlier format drafts (luma, chroma, alpha rows). */
function bandedQmax(ch: Channel, i: number, j: number, nx: number, ny: number): number {
  const rows: Record<number, number[]> = { 0: [9, 7, 5], 1: [5, 3, 2], 2: [5, 3, 2], 3: [5, 3, 2] };
  const S = i * i * ny * ny + j * j * nx * nx;
  const T = nx * nx * ny * ny;
  const row = rows[ch];
  return 100 * S < 6 * T ? row[0] : 100 * S < 25 * T ? row[1] : row[2];
}

const HEADER = 7;
const BISECT = 12;

interface Entry {
  ch: Channel;
  i: number;
  j: number;
  nx: number;
  ny: number;
  qmax: number;
}

function entriesFor(v: Variant, Lx: number, Ly: number, Cx: number, Cy: number): Entry[] {
  const list: Entry[] = [];
  const dims: Array<[number, number]> = [
    [Lx, Ly],
    [Cx, Cy],
    [Cx, Cy],
  ];
  dims.forEach(([nx, ny], ch) => {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (i === 0 && j === 0) continue;
        if (v.mask === 'tri' && !((i * ny + j * nx) * 4 < (v.maskQuarters ?? 4) * nx * ny))
          continue;
        let qmax =
          v.qmax === 'flat' ? v.flat![ch === 0 ? 0 : 1] : bandedQmax(ch as Channel, i, j, nx, ny);
        if (v.entropy === 'fixed4') qmax = Math.min(qmax, 7);
        list.push({ ch: ch as Channel, i, j, nx, ny, qmax });
      }
    }
  });
  list.sort((p, q) => {
    const pn = p.i * p.i * p.ny * p.ny + p.j * p.j * p.nx * p.nx;
    const pd = p.nx * p.nx * p.ny * p.ny;
    const qn = q.i * q.i * q.ny * q.ny + q.j * q.j * q.nx * q.nx;
    const qd = q.nx * q.nx * q.ny * q.ny;
    return pn * qd - qn * pd || p.ch - q.ch || p.j - q.j || p.i - q.i;
  });
  return list;
}

function candidateGrids(
  maxX: number,
  maxY: number,
  r: number,
  tol: number,
): Array<[number, number]> {
  const all: Array<{ nx: number; ny: number; d: number }> = [];
  for (let nx = 1; nx <= maxX; nx++) {
    for (let ny = 1; ny <= maxY; ny++) {
      all.push({ nx, ny, d: Math.abs(Math.log(nx / ny) - Math.log(r)) });
    }
  }
  let picked = all.filter((g) => g.d <= Math.log(tol) + 1e-9);
  if (picked.length === 0) {
    picked = all
      .slice()
      .sort((p, q) => p.d - q.d || p.nx * p.ny - q.nx * q.ny)
      .slice(0, 4);
  }
  if (!picked.some((g) => g.nx === 1 && g.ny === 1)) picked.push(all[0]);
  return picked.sort((p, q) => p.nx - q.nx || p.ny - q.ny).map((g) => [g.nx, g.ny]);
}

interface Solved {
  q: Int32Array;
  k: number[];
  size: number;
  D: number;
}

function runCombo(
  v: Variant,
  budget: number,
  coefs: Float64Array[],
  totalEnergy: number,
  weights: number[],
  grid: { Lx: number; Ly: number; Cx: number; Cy: number },
) {
  const order = entriesFor(v, grid.Lx, grid.Ly, grid.Cx, grid.Cy);
  const n = order.length;
  const cval = new Float64Array(n);
  const wgt = new Float64Array(n);
  const sOf = new Float64Array(n);
  const q0 = new Int32Array(n);
  const maxAbs = [0, 0, 0];
  for (let e = 0; e < n; e++) {
    const { ch, i, j } = order[e];
    const c = coefs[ch][j * AN + i];
    cval[e] = c;
    wgt[e] = weights[ch] * (i > 0 ? 0.5 : 1) * (j > 0 ? 0.5 : 1);
    maxAbs[ch] = Math.max(maxAbs[ch], Math.abs(c));
  }
  const scale = [0, 1, 2].map((ch) => chooseScaleCode(ch as Channel, maxAbs[ch]));
  let kept = 0;
  for (let e = 0; e < n; e++) {
    sOf[e] = scaleOf(order[e].ch, scale[order[e].ch]);
    q0[e] = quantizeAc(cval[e], sOf[e], order[e].qmax);
    kept += wgt[e] * cval[e] * cval[e];
  }
  const dropped = Math.max(0, totalEnergy - kept);

  const sizeOf = (q: Int32Array, k: number[]): number => {
    let pos = 0;
    let lastOne = -1;
    for (let e = 0; e < n; e++) {
      const z = zigzag(q[e]);
      if (v.entropy === 'rice') {
        const kk = k[order[e].ch];
        const unary = z >> kk;
        if (z !== 0) {
          const low = z & ((1 << kk) - 1);
          lastOne =
            low !== 0
              ? pos + unary + 1 + (kk - 1 - (31 - Math.clz32(low & -low)))
              : pos + unary - 1;
        }
        pos += unary + 1 + kk;
      } else {
        if (z !== 0) lastOne = pos + 3 - (31 - Math.clz32(z & -z));
        pos += 4;
      }
    }
    return HEADER + (lastOne < 0 ? 0 : (lastOne >> 3) + 1);
  };

  const bestK = (q: Int32Array): number[] => {
    if (v.entropy !== 'rice') return [0, 0, 0];
    const lens = new Float64Array(12);
    for (let e = 0; e < n; e++) {
      for (let k = 0; k < 4; k++) lens[order[e].ch * 4 + k] += riceLength(q[e], k);
    }
    return [0, 1, 2].map((ch) => {
      let best = 0;
      for (let k = 1; k < 4; k++) if (lens[ch * 4 + k] < lens[ch * 4 + best]) best = k;
      return best;
    });
  };

  const quantize = (lambda: number, k: number[]): Int32Array => {
    if (lambda === 0) return q0.slice();
    const q = new Int32Array(n);
    for (let e = 0; e < n; e++) {
      const qm = order[e].qmax;
      let bq = 0;
      let bc = Infinity;
      for (const cand of [q0[e] - 1, q0[e], q0[e] + 1, 0]) {
        if (cand < -qm || cand > qm) continue;
        const err = cval[e] - dequantizeAc(cand, sOf[e], qm);
        const bits = v.entropy === 'rice' ? riceLength(cand, k[order[e].ch]) : 4;
        const cost = wgt[e] * err * err + lambda * bits;
        if (
          cost < bc ||
          (cost === bc &&
            (Math.abs(cand) < Math.abs(bq) || (Math.abs(cand) === Math.abs(bq) && cand > bq)))
        ) {
          bc = cost;
          bq = cand;
        }
      }
      q[e] = bq;
    }
    return q;
  };

  const error = (q: Int32Array): number => {
    let D = dropped;
    for (let e = 0; e < n; e++) {
      const d = cval[e] - dequantizeAc(q[e], sOf[e], order[e].qmax);
      D += wgt[e] * d * d;
    }
    return D;
  };

  const solve = (lambda: number): Solved => {
    let k = bestK(q0);
    let q: Int32Array = q0;
    let kNew = k;
    for (let it = 0; it < 3; it++) {
      q = quantize(lambda, k);
      kNew = bestK(q);
      if (kNew.every((x, i) => x === k[i])) break;
      k = kNew;
    }
    return { q, k: kNew, size: sizeOf(q, kNew), D: error(q) };
  };

  const truncate = (from: Solved): Solved => {
    const q = from.q.slice();
    let k = from.k;
    let size = from.size;
    for (let e = n - 1; e >= 0 && size > budget; e--) {
      q[e] = 0;
      k = bestK(q);
      size = sizeOf(q, k);
    }
    return { q, k, size, D: error(q) };
  };

  const best = (): Solved => {
    const first = solve(0);
    if (first.size <= budget) return first;
    if (!v.rdo) return truncate(first);
    let hiL = 0;
    for (let e = 0; e < n; e++) hiL = Math.max(hiL, wgt[e] * cval[e] * cval[e]);
    hiL *= 2;
    let loL = hiL * Math.pow(2, -16);
    let hi = solve(hiL);
    if (hi.size > budget) hi = truncate(hi);
    let winner = hi;
    for (let s = 0; s < BISECT; s++) {
      const lambda = Math.sqrt(loL * hiL);
      const cand = solve(lambda);
      if (cand.size <= budget) {
        hiL = lambda;
        if (cand.D < winner.D || (cand.D === winner.D && cand.size < winner.size)) winner = cand;
      } else loL = lambda;
    }
    return winner;
  };

  return { order, scale, sOf, best };
}

export interface LabResult {
  size: number;
  out: Raw;
}

/** Converts OKLab planes to the chosen coding space (in place semantics: returns new planes). */
function toSpace(v: Variant, planes: Float64Array[]): Float64Array[] {
  if (v.space === 'oklab') return planes;
  const n = planes[0].length;
  const out = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  const rgb = [0, 0, 0];
  for (let p = 0; p < n; p++) {
    oklabToGamutLinear(clamp(planes[0][p], 0, 1), planes[1][p], planes[2][p], rgb);
    const [r, g, b] = rgb.map((c) => linearToSrgb(c));
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    out[0][p] = y;
    out[1][p] = (b - y) * 0.564 * 0.64;
    out[2][p] = (r - y) * 0.713 * 0.64;
  }
  return out;
}

export function labRoundtrip(image: RgbaImage, budget: number, v: Variant): LabResult {
  const prep = prepare(image, 64);
  const { width: Wa, height: Ha } = prep;
  const planes = toSpace(v, [prep.L, prep.a, prep.b]);
  const nxA = Math.min(AN, Wa);
  const nyA = Math.min(AN, Ha);
  const cx = cosTable(nxA, Wa);
  const cy = cosTable(nyA, Ha);
  const coefs = planes.map((p) => analyze(p, Wa, Ha, nxA, nyA, cx, cy));
  const weights = [1, 1, 1];
  let totalEnergy = 0;
  for (let ch = 0; ch < 3; ch++) {
    for (let j = 0; j < nyA; j++) {
      for (let i = 0; i < nxA; i++) {
        if (i === 0 && j === 0) continue;
        totalEnergy +=
          weights[ch] * (i > 0 ? 0.5 : 1) * (j > 0 ? 0.5 : 1) * coefs[ch][j * AN + i] ** 2;
      }
    }
  }
  const dcQ = coefs.map((c, ch) => dcQuantize(ch as Channel, c[0]));

  const r = image.width / image.height;
  const lGrids = candidateGrids(Math.min(8, Wa), Math.min(8, Ha), r, PARAMS.tolLuma);
  const cGrids = candidateGrids(Math.min(4, Wa), Math.min(4, Ha), r, PARAMS.tolChroma);
  const combos: Array<{ Lx: number; Ly: number; Cx: number; Cy: number }> = [];
  for (const [Lx, Ly] of lGrids) {
    if (v.grids === 'single') combos.push({ Lx, Ly, Cx: Lx, Cy: Ly });
    else {
      for (const [Cx, Cy] of cGrids) if (Cx <= Lx && Cy <= Ly) combos.push({ Lx, Ly, Cx, Cy });
    }
  }

  let bestCombo: ReturnType<typeof runCombo> | null = null;
  let best: Solved | null = null;
  let bestGrid = combos[0];
  for (const grid of combos) {
    const combo = runCombo(v, budget, coefs, totalEnergy, weights, grid);
    const cand = combo.best();
    if (!best || cand.D < best.D || (cand.D === best.D && cand.size < best.size)) {
      best = cand;
      bestCombo = combo;
      bestGrid = grid;
    }
  }
  const finalCombo = bestCombo!;
  const solved = best!;

  // Reconstruct coefficients and decode like the production decoder.
  const [Wo, Ho] = outputSize(codeToAspect(aspectToCode(r)), 32);
  const dims: Array<[number, number]> = [
    [bestGrid.Lx, bestGrid.Ly],
    [bestGrid.Cx, bestGrid.Cy],
    [bestGrid.Cx, bestGrid.Cy],
  ];
  const rec = dims.map(([nx, ny], ch) => {
    const c = new Float64Array(nx * ny);
    c[0] = dcDequantize(ch as Channel, dcQ[ch]);
    return c;
  });
  finalCombo.order.forEach((e, idx) => {
    rec[e.ch][e.j * e.nx + e.i] = dequantizeAc(solved.q[idx], finalCombo.sOf[idx], e.qmax);
  });
  const outPlanes = dims.map(([nx, ny], ch) => {
    const plane = new Float64Array(Wo * Ho);
    synthesize(rec[ch], nx, nx, ny, Wo, Ho, plane);
    return plane;
  });

  const data = new Uint8ClampedArray(Wo * Ho * 4);
  const rgb = [0, 0, 0];
  for (let y = 0; y < Ho; y++) {
    for (let x = 0; x < Wo; x++) {
      const p = y * Wo + x;
      const u = fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y));
      let srgb: number[];
      if (v.space === 'oklab') {
        oklabToGamutLinear(clamp(outPlanes[0][p], 0, 1), outPlanes[1][p], outPlanes[2][p], rgb);
        srgb = rgb.map((c) => linearToSrgb(c));
      } else {
        const Y = clamp(outPlanes[0][p], 0, 1);
        const cb = outPlanes[1][p] / (0.564 * 0.64);
        const cr = outPlanes[2][p] / (0.713 * 0.64);
        const R = Y + cr;
        const B = Y + cb;
        const G = (Y - 0.299 * R - 0.114 * B) / 0.587;
        srgb = [R, G, B].map((c) => clamp(c, 0, 1));
      }
      for (let c = 0; c < 3; c++) data[p * 4 + c] = clamp(Math.floor(srgb[c] * 255 + u), 0, 255);
      data[p * 4 + 3] = 255;
    }
  }
  return { size: solved.size, out: { width: Wo, height: Ho, data } };
}

function fract(x: number): number {
  return x - Math.floor(x);
}
