import { PARAMS } from './params';

/** Component grids, coefficient mask and stream order. */

export interface Grids {
  Lx: number;
  Ly: number;
  Cx: number;
  Cy: number;
  alpha: boolean;
  Ax: number;
  Ay: number;
}

/** Channel: 0 = L, 1 = a, 2 = b, 3 = A. */
export type Channel = 0 | 1 | 2 | 3;

export interface Entry {
  ch: Channel;
  i: number;
  j: number;
  nx: number;
  ny: number;
  qmax: number;
}

/** Number of positive quantization levels of a channel (alpha shares the chroma value). */
export function qmaxOf(ch: Channel): number {
  return ch === 0 ? PARAMS.qmaxL : PARAMS.qmaxC;
}

/** A coefficient is stored when i/nx + j/ny < 1.5 (integer form, no floating point). */
export function inMask(i: number, j: number, nx: number, ny: number): boolean {
  return 2 * (i * ny + j * nx) < 3 * nx * ny;
}

export function gridOf(g: Grids, ch: Channel): [number, number] {
  return ch === 0 ? [g.Lx, g.Ly] : ch === 3 ? [g.Ax, g.Ay] : [g.Cx, g.Cy];
}

/** All AC coefficients of all channels in stream order (ascending frequency radius). */
export function buildOrder(g: Grids): Entry[] {
  const list: Entry[] = [];
  const channels: Channel[] = g.alpha ? [0, 1, 2, 3] : [0, 1, 2];
  for (const ch of channels) {
    const [nx, ny] = gridOf(g, ch);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if ((i === 0 && j === 0) || !inMask(i, j, nx, ny)) continue;
        list.push({ ch, i, j, nx, ny, qmax: qmaxOf(ch) });
      }
    }
  }
  list.sort((p, q) => {
    // rho^2 = (i²·ny² + j²·nx²) / (nx²·ny²), compared by cross-multiplication
    const pn = p.i * p.i * p.ny * p.ny + p.j * p.j * p.nx * p.nx;
    const pd = p.nx * p.nx * p.ny * p.ny;
    const qn = q.i * q.i * q.ny * q.ny + q.j * q.j * q.nx * q.nx;
    const qd = q.nx * q.nx * q.ny * q.ny;
    const d = pn * qd - qn * pd;
    if (d !== 0) return d;
    if (p.ch !== q.ch) return p.ch - q.ch;
    if (p.j !== q.j) return p.j - q.j;
    return p.i - q.i;
  });
  return list;
}
