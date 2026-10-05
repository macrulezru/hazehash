import { cosTable, synthesize } from './basis';
import { analyze, AN } from './encoder/analysis';
import { toBase64Url } from './encoder/base64';
import { BitWriter, writeRice } from './encoder/bits';
import { PlaceholderError } from './errors';
import { headerSize, type Header } from './format';
import { aspectToCode, writeHeader } from './encoder/header';
import {
  buildOrder as buildOrderUncached,
  gridOf,
  inMask,
  type Channel,
  type Entry,
  type Grids,
} from './layout';
import { PARAMS } from './params';
import { prepare } from './encoder/prepare';
import { dcDequantize, dequantizeAc, scaleOf } from './quant';
import { chooseScaleCode, dcQuantize, quantizeAc } from './encoder/quant';
import type { EncodeOptions, RgbaImage } from './types';

export { toBase64Url };
export { PlaceholderError } from './errors';
export type { PlaceholderErrorCode } from './errors';
export type { EncodeOptions, RgbaImage } from './types';

const orderCache = new Map<string, Entry[]>();

/** Drops cached orders; needed only when PARAMS change (tuning harness). */
export function resetOrderCache(): void {
  orderCache.clear();
}

function buildOrder(g: Grids): Entry[] {
  const key = `${g.Lx}${g.Ly}${g.Cx}${g.Cy}${g.alpha ? `${g.Ax}${g.Ay}` : '-'}`;
  let order = orderCache.get(key);
  if (!order) {
    order = buildOrderUncached(g);
    orderCache.set(key, order);
  }
  return order;
}

const BISECT_STEPS = 8;
const MAX_BUDGET = 1024;

interface Resolved {
  budget: number;
  analysisSize: number;
  alpha: 'auto' | boolean;
  wL: number;
  wC: number;
  wA: number;
  profile: 'fast' | 'default' | 'high';
}

function resolve(options: EncodeOptions): Resolved {
  const num = (v: unknown, def: number, name: string): number => {
    if (v === undefined) return def;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new PlaceholderError('InvalidInput', `${name} must be a finite number`);
    }
    return v;
  };
  const weight = (v: unknown, name: string): number => {
    const w = num(v, 1, name);
    if (w < 0) throw new PlaceholderError('InvalidInput', `${name} must be >= 0`);
    return w;
  };
  const profile = options.profile ?? 'default';
  if (profile !== 'fast' && profile !== 'default' && profile !== 'high') {
    throw new PlaceholderError('InvalidInput', 'unknown profile');
  }
  const alpha = options.alpha ?? 'auto';
  if (alpha !== 'auto' && typeof alpha !== 'boolean') {
    throw new PlaceholderError('InvalidInput', 'alpha must be "auto" or boolean');
  }
  const analysisSize = Math.round(num(options.analysisSize, 64, 'analysisSize'));
  return {
    budget: Math.min(MAX_BUDGET, Math.floor(num(options.budget, 28, 'budget'))),
    analysisSize: Math.min(128, Math.max(32, analysisSize)),
    alpha,
    wL: weight(options.weights?.L, 'weights.L'),
    wC: weight(options.weights?.C, 'weights.C'),
    wA: weight(options.weights?.A, 'weights.A'),
    profile,
  };
}

function checkImage(image: RgbaImage): void {
  const ok =
    image &&
    Number.isInteger(image.width) &&
    Number.isInteger(image.height) &&
    image.width >= 1 &&
    image.height >= 1 &&
    image.data &&
    image.data.length === 4 * image.width * image.height;
  if (!ok) {
    throw new PlaceholderError('InvalidInput', 'expected RGBA data of length 4·width·height');
  }
}

/** Allowed grids (nx, ny) in ascending (nx, ny) order. */
function candidateGrids(
  maxX: number,
  maxY: number,
  r: number,
  tolerance: number,
  limit: number,
): Array<[number, number]> {
  const all: Array<{ nx: number; ny: number; d: number }> = [];
  for (let nx = 1; nx <= maxX; nx++) {
    for (let ny = 1; ny <= maxY; ny++) {
      all.push({ nx, ny, d: Math.abs(Math.log(nx / ny) - Math.log(r)) });
    }
  }
  const byCloseness = (p: (typeof all)[number], q: (typeof all)[number]) =>
    p.d - q.d || p.nx * p.ny - q.nx * q.ny || p.nx - q.nx || p.ny - q.ny;
  let picked = all.filter((g) => g.d <= Math.log(tolerance) + 1e-9);
  if (picked.length === 0) picked = all.slice().sort(byCloseness).slice(0, 4);
  if (picked.length > limit) picked = picked.sort(byCloseness).slice(0, limit);
  if (!picked.some((g) => g.nx === 1 && g.ny === 1)) picked.push(all[0]);
  return picked.sort((p, q) => p.nx - q.nx || p.ny - q.ny).map((g) => [g.nx, g.ny]);
}

interface Candidate {
  q: Int32Array;
  k: [number, number, number, number];
  size: number;
  D: number;
  lambda: number;
}

interface Shared {
  budget: number;
  aspectCode: number;
  alpha: boolean;
  dcQ: [number, number, number, number];
  coefs: Float64Array[];
  /** Analysis size and OKLab planes (for pixel-domain refinement). */
  Wa: number;
  Ha: number;
  planes: Float64Array[];
  weights: number[];
  /** Weighted energy of all analysis AC coefficients per channel. */
  totalEnergy: number[];
}

/** Quantization machinery for one grid combination. */
const lenScratch = new Int32Array(16);

function makeCombo(shared: Shared, grids: Grids) {
  const order: Entry[] = buildOrder(grids);
  const n = order.length;
  const channels: Channel[] = shared.alpha ? [0, 1, 2, 3] : [0, 1, 2];
  const cval = new Float64Array(n);
  const wgt = new Float64Array(n);
  const sOf = new Float64Array(n);
  const q0 = new Int32Array(n);
  const maxAbs = [0, 0, 0, 0];
  for (let e = 0; e < n; e++) {
    const { ch, i, j } = order[e];
    const c = shared.coefs[ch][j * AN + i];
    cval[e] = c;
    wgt[e] = shared.weights[ch] * (i > 0 ? 0.5 : 1) * (j > 0 ? 0.5 : 1);
    if (Math.abs(c) > maxAbs[ch]) maxAbs[ch] = Math.abs(c);
  }
  const scale: [number, number, number, number] = [0, 0, 0, 0];
  const s = [0, 0, 0, 0];
  for (const ch of channels) {
    scale[ch] = chooseScaleCode(ch, maxAbs[ch]);
    s[ch] = scaleOf(ch, scale[ch]);
  }
  let kept = 0;
  for (let e = 0; e < n; e++) {
    sOf[e] = s[order[e].ch];
    q0[e] = quantizeAc(cval[e], sOf[e], order[e].qmax);
    kept += wgt[e] * cval[e] * cval[e];
  }
  let totalEnergy = 0;
  for (const ch of channels) totalEnergy += shared.totalEnergy[ch];
  const dropped = Math.max(0, totalEnergy - kept);

  const header = (k: number[]): Header => ({
    aspectCode: shared.aspectCode,
    alpha: shared.alpha,
    Lx: grids.Lx,
    Ly: grids.Ly,
    Cx: grids.Cx,
    Cy: grids.Cy,
    Ax: grids.Ax,
    Ay: grids.Ay,
    dc: shared.dcQ,
    scale,
    k: k as Header['k'],
  });
  const hdrSize = headerSize(shared.alpha);

  const pack = (q: Int32Array, k: number[]): Uint8Array => {
    const w = new BitWriter();
    writeHeader(w, header(k));
    for (let e = 0; e < n; e++) writeRice(w, q[e], k[order[e].ch]);
    const bytes = w.finish();
    let end = bytes.length;
    while (end > hdrSize && bytes[end - 1] === 0) end--;
    return bytes.slice(0, end);
  };

  /** Size of pack(q, k) without writing bits: header plus data up to the last set bit. */
  const sizeOf = (q: Int32Array, k: number[]): number => {
    let pos = 0;
    let lastOne = -1;
    for (let e = 0; e < n; e++) {
      const kk = k[order[e].ch];
      const v = q[e];
      const z = v >= 0 ? 2 * v : -2 * v - 1;
      const unary = z >> kk;
      if (z !== 0) {
        const low = z & ((1 << kk) - 1);
        lastOne =
          low !== 0 ? pos + unary + 1 + (kk - 1 - (31 - Math.clz32(low & -low))) : pos + unary - 1;
      }
      pos += unary + 1 + kk;
    }
    return hdrSize + (lastOne < 0 ? 0 : (lastOne >> 3) + 1);
  };

  const bestK = (q: Int32Array): [number, number, number, number] => {
    const lens = lenScratch.fill(0);
    for (let e = 0; e < n; e++) {
      const v = q[e];
      const z = v >= 0 ? 2 * v : -2 * v - 1;
      const base = order[e].ch * 4;
      lens[base] += z + 1;
      lens[base + 1] += (z >> 1) + 2;
      lens[base + 2] += (z >> 2) + 3;
      lens[base + 3] += (z >> 3) + 4;
    }
    const out: [number, number, number, number] = [0, 0, 0, 0];
    for (let ch = 0; ch < 4; ch++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (lens[ch * 4 + k] < lens[ch * 4 + best]) best = k;
      out[ch] = best;
    }
    return out;
  };

  // Candidate levels per coefficient (q0 - 1, q0, q0 + 1, 0) and their weighted distortions,
  // computed once: only the rate term changes between lambda values.
  const candQ = new Int32Array(4 * n);
  const candD = new Float64Array(4 * n);
  let distortion0 = dropped;
  for (let e = 0; e < n; e++) {
    const qm = order[e].qmax;
    for (let t = 0; t < 4; t++) {
      const cand = t === 0 ? q0[e] - 1 : t === 1 ? q0[e] : t === 2 ? q0[e] + 1 : 0;
      candQ[4 * e + t] = cand;
      const err = cval[e] - dequantizeAc(cand, sOf[e], qm);
      candD[4 * e + t] = cand < -qm || cand > qm ? Infinity : wgt[e] * err * err;
    }
    distortion0 += candD[4 * e + 1];
  }
  /** Total error of the levels returned by the latest quantize() call. */
  let lastD = distortion0;

  const quantize = (lambda: number, k: number[]): Int32Array => {
    if (lambda === 0) {
      lastD = distortion0;
      return q0.slice();
    }
    const q = new Int32Array(n);
    let total = dropped;
    for (let e = 0; e < n; e++) {
      const kk = k[order[e].ch];
      let bq = 0;
      let bd = 0;
      let bc = Infinity;
      for (let t = 0; t < 4; t++) {
        const d = candD[4 * e + t];
        if (d === Infinity) continue;
        const cand = candQ[4 * e + t];
        const z = cand >= 0 ? 2 * cand : -2 * cand - 1;
        const cost = d + lambda * ((z >> kk) + 1 + kk);
        if (
          cost < bc ||
          (cost === bc &&
            (Math.abs(cand) < Math.abs(bq) || (Math.abs(cand) === Math.abs(bq) && cand > bq)))
        ) {
          bc = cost;
          bq = cand;
          bd = d;
        }
      }
      q[e] = bq;
      total += bd;
    }
    lastD = total;
    return q;
  };

  const error = (q: Int32Array): number => {
    let D = dropped;
    for (let e = 0; e < n; e++) {
      const err = cval[e] - dequantizeAc(q[e], sOf[e], order[e].qmax);
      D += wgt[e] * err * err;
    }
    return D;
  };

  const solve = (lambda: number): Candidate => {
    let k: number[] = bestK(q0);
    let q: Int32Array = q0;
    let kNew = k as [number, number, number, number];
    let D = distortion0;
    for (let it = 0; it < 3; it++) {
      q = quantize(lambda, k);
      D = lastD;
      kNew = bestK(q);
      if (kNew.every((v, i) => v === k[i])) break;
      k = kNew;
    }
    return { q, k: kNew, size: sizeOf(q, kNew), D, lambda };
  };

  /** Best candidate within the budget (rate-distortion bisection over lambda). */
  const best = (): Candidate => {
    const first = solve(0);
    if (first.size <= shared.budget) return first;

    let lambdaHi = 0;
    for (let e = 0; e < n; e++) lambdaHi = Math.max(lambdaHi, wgt[e] * cval[e] * cval[e]);
    lambdaHi *= 2;
    let lambdaLo = lambdaHi * Math.pow(2, -16);

    let hi = solve(lambdaHi);
    if (hi.size > shared.budget) {
      // Forced truncation: zero coefficients from the end of the stream order.
      const q = hi.q.slice();
      let k = hi.k;
      let size = hi.size;
      for (let e = n - 1; e >= 0 && size > shared.budget; e--) {
        q[e] = 0;
        k = bestK(q);
        size = sizeOf(q, k);
      }
      hi = { q, k, size, D: error(q), lambda: lambdaHi };
    }
    let winner = hi;
    for (let step = 0; step < BISECT_STEPS; step++) {
      const lambda = Math.sqrt(lambdaLo * lambdaHi);
      const cand = solve(lambda);
      if (cand.size <= shared.budget) {
        lambdaHi = lambda;
        if (
          cand.D < winner.D ||
          (cand.D === winner.D &&
            (cand.size < winner.size || (cand.size === winner.size && cand.lambda < winner.lambda)))
        ) {
          winner = cand;
        }
      } else {
        lambdaLo = lambda;
      }
    }
    return winner;
  };

  /**
   * Pixel-domain refinement: tries q +/- 1 per coefficient (largest contribution first) and keeps
   * a change when the mean OKLab distance on the analysis grid drops and the size still fits.
   * The decoded planes are tracked linearly; gamut mapping and 8-bit rounding are ignored.
   */
  const refine = (cand: Candidate): Candidate => {
    const { Wa, Ha, planes } = shared;
    const px = Wa * Ha;
    const lumaChroma: Channel[] = [0, 1, 2];
    const coefs = lumaChroma.map((ch) => {
      const [nx, ny] = gridOf(grids, ch);
      const c = new Float64Array(nx * ny);
      c[0] = dcDequantize(ch, shared.dcQ[ch]);
      return c;
    });
    const q = cand.q.slice();
    for (let e = 0; e < n; e++) {
      const { ch, i, j, nx, qmax } = order[e];
      if (ch < 3) coefs[ch][j * nx + i] = dequantizeAc(q[e], sOf[e], qmax);
    }
    // diff[ch] = decoded - reference
    const diff = lumaChroma.map((ch) => {
      const [nx, ny] = gridOf(grids, ch);
      const out = new Float64Array(px);
      synthesize(coefs[ch], nx, nx, ny, Wa, Ha, out);
      for (let p = 0; p < px; p++) out[p] -= planes[ch][p];
      return out;
    });
    const total = (): number => {
      let sum = 0;
      for (let p = 0; p < px; p++) {
        sum += Math.sqrt(diff[0][p] ** 2 + diff[1][p] ** 2 + diff[2][p] ** 2);
      }
      return sum;
    };
    let current = total();
    const cosX = cosTable(Math.min(AN, Wa), Wa);
    const cosY = cosTable(Math.min(AN, Ha), Ha);
    const queue: number[] = [];
    for (let e = 0; e < n; e++) if (order[e].ch < 3) queue.push(e);
    queue.sort((p, r) => wgt[r] * cval[r] ** 2 - wgt[p] * cval[p] ** 2 || p - r);

    let k = cand.k;
    let size = cand.size;
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (const e of queue) {
        const { ch, i, j, qmax } = order[e];
        for (const delta of [1, -1]) {
          const q2 = q[e] + delta;
          if (q2 < -qmax || q2 > qmax) continue;
          const dc = dequantizeAc(q2, sOf[e], qmax) - dequantizeAc(q[e], sOf[e], qmax);
          let sum = 0;
          for (let y = 0; y < Ha; y++) {
            const by = dc * cosY[j * Ha + y];
            for (let x = 0; x < Wa; x++) {
              const p = y * Wa + x;
              const d = by * cosX[i * Wa + x];
              const a = diff[0][p] + (ch === 0 ? d : 0);
              const b = diff[1][p] + (ch === 1 ? d : 0);
              const c = diff[2][p] + (ch === 2 ? d : 0);
              sum += Math.sqrt(a * a + b * b + c * c);
            }
          }
          if (sum >= current - 1e-12) continue;
          const old = q[e];
          q[e] = q2;
          const k2 = bestK(q);
          const size2 = sizeOf(q, k2);
          if (size2 > shared.budget) {
            q[e] = old;
            continue;
          }
          for (let y = 0; y < Ha; y++) {
            const by = dc * cosY[j * Ha + y];
            for (let x = 0; x < Wa; x++) diff[ch][y * Wa + x] += by * cosX[i * Wa + x];
          }
          current = sum;
          k = k2;
          size = size2;
          changed = true;
          break;
        }
      }
      if (!changed) break;
    }
    return { q, k, size, D: error(q), lambda: cand.lambda };
  };

  return { dropped, best, refine, pack };
}

function compareTuple(p: number[], q: number[]): number {
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] - q[i];
  return 0;
}

export function encode(image: RgbaImage, options: EncodeOptions = {}): Uint8Array {
  checkImage(image);
  const opts = resolve(options);
  const prepared = prepare(image, opts.analysisSize);
  const { width: Wa, height: Ha } = prepared;
  const alpha = opts.alpha === 'auto' ? prepared.minAlpha < 254 / 255 : opts.alpha;
  if (opts.budget < headerSize(alpha)) {
    throw new PlaceholderError('BudgetTooSmall');
  }

  const r = image.width / image.height;
  const nxA = Math.min(AN, Wa);
  const nyA = Math.min(AN, Ha);
  const cosX = cosTable(nxA, Wa);
  const cosY = cosTable(nyA, Ha);
  const planes = [prepared.L, prepared.a, prepared.b, prepared.A];
  const coefs = (alpha ? planes : planes.slice(0, 3)).map((p) =>
    analyze(p, Wa, Ha, nxA, nyA, cosX, cosY),
  );
  const weights = [opts.wL, opts.wC, opts.wC, opts.wA];
  const totalEnergy = coefs.map((c, ch) => {
    let sum = 0;
    for (let j = 0; j < nyA; j++) {
      for (let i = 0; i < nxA; i++) {
        if (i === 0 && j === 0) continue;
        const v = c[j * AN + i];
        sum += weights[ch] * (i > 0 ? 0.5 : 1) * (j > 0 ? 0.5 : 1) * v * v;
      }
    }
    return sum;
  });
  const shared: Shared = {
    budget: opts.budget,
    aspectCode: aspectToCode(r),
    alpha,
    dcQ: [
      dcQuantize(0, coefs[0][0]),
      dcQuantize(1, coefs[1][0]),
      dcQuantize(2, coefs[2][0]),
      alpha ? dcQuantize(3, coefs[3][0]) : 0,
    ],
    coefs,
    Wa,
    Ha,
    planes,
    weights,
    totalEnergy,
  };

  const fast = opts.profile === 'fast';
  const lGrids = candidateGrids(
    Math.min(8, Wa),
    Math.min(8, Ha),
    r,
    PARAMS.tolLuma,
    fast ? 6 : Infinity,
  );
  const cGrids = candidateGrids(
    Math.min(4, Wa),
    Math.min(4, Ha),
    r,
    PARAMS.tolChroma,
    fast ? 3 : Infinity,
  );
  const aGrids: Array<[number, number]> = alpha
    ? candidateGrids(Math.min(4, Wa), Math.min(4, Ha), r, PARAMS.tolChroma, fast ? 2 : Infinity)
    : [[1, 1]];

  // Every combination is bounded below by the energy its masks drop. Visiting combinations by
  // ascending bound lets us stop as soon as the bound exceeds the best error found so far.
  // kept[ch][ny * 9 + nx] is the weighted energy of the AC coefficients inside that grid's mask.
  const channelCount = alpha ? 4 : 3;
  let totalAll = 0;
  for (let ch = 0; ch < channelCount; ch++) totalAll += totalEnergy[ch];
  const kept: Float64Array[] = [];
  for (let ch = 0; ch < channelCount; ch++) {
    const table = new Float64Array(81);
    for (let ny = 1; ny <= nyA; ny++) {
      for (let nx = 1; nx <= nxA; nx++) {
        let sum = 0;
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            if ((i === 0 && j === 0) || !inMask(i, j, nx, ny)) continue;
            const v = coefs[ch][j * AN + i];
            sum += weights[ch] * (i > 0 ? 0.5 : 1) * (j > 0 ? 0.5 : 1) * v * v;
          }
        }
        table[ny * 9 + nx] = sum;
      }
    }
    kept.push(table);
  }
  interface Pending {
    grids: Grids;
    bound: number;
    tuple: number[];
  }
  const pending: Pending[] = [];
  for (const [Lx, Ly] of lGrids) {
    for (const [Cx, Cy] of cGrids) {
      if (Cx > Lx || Cy > Ly) continue;
      for (const [Ax, Ay] of aGrids) {
        const grids: Grids = { Lx, Ly, Cx, Cy, alpha, Ax, Ay };
        let keptSum = kept[0][Ly * 9 + Lx] + kept[1][Cy * 9 + Cx] + kept[2][Cy * 9 + Cx];
        if (alpha) keptSum += kept[3][Ay * 9 + Ax];
        pending.push({ grids, bound: totalAll - keptSum, tuple: [Lx, Ly, Cx, Cy, Ax, Ay] });
      }
    }
  }
  pending.sort((p, r) => p.bound - r.bound || compareTuple(p.tuple, r.tuple));

  let best: Candidate | null = null;
  let bestEntry: { combo: ReturnType<typeof makeCombo>; tuple: number[] } | null = null;
  for (const item of pending) {
    // Slack covers float summation order differences between the table and the exact error.
    if (best && item.bound > best.D * (1 + 1e-9) + 1e-18) break;
    const combo = makeCombo(shared, item.grids);
    const cand = combo.best();
    if (
      !best ||
      !bestEntry ||
      cand.D < best.D ||
      (cand.D === best.D &&
        (cand.size < best.size ||
          (cand.size === best.size && compareTuple(item.tuple, bestEntry.tuple) < 0)))
    ) {
      best = cand;
      bestEntry = { combo, tuple: item.tuple };
    }
  }
  if (best && bestEntry && opts.profile === 'high') {
    best = bestEntry.combo.refine(best);
  }
  // The exact size check guards against any mismatch with the arithmetic size estimate.
  const bytes = best && bestEntry ? bestEntry.combo.pack(best.q, best.k) : null;
  if (!bytes || bytes.length > opts.budget) throw new PlaceholderError('BudgetTooSmall');
  return bytes;
}

export function encodeToString(image: RgbaImage, options?: EncodeOptions): string {
  return toBase64Url(encode(image, options));
}
