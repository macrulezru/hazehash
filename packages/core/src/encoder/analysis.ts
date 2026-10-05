import { cosTable } from '../basis';

/** Stride (and maximum size) of the analysis coefficient block. */
export const AN = 8;

/**
 * Analysis: coefficients c[j·AN + i] for i < nx, j < ny (the rest are zero).
 * Requires nx <= W and ny <= H.
 */
export function analyze(
  plane: Float64Array,
  W: number,
  H: number,
  nx: number,
  ny: number,
  cosX = cosTable(nx, W),
  cosY = cosTable(ny, H),
): Float64Array {
  const out = new Float64Array(AN * AN);
  const rows = new Float64Array(nx * H); // rows[i·H + y]
  for (let y = 0; y < H; y++) {
    for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let x = 0; x < W; x++) s += plane[y * W + x] * cosX[i * W + x];
      rows[i * H + y] = s;
    }
  }
  const inv = 1 / (W * H);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      let s = 0;
      for (let y = 0; y < H; y++) s += rows[i * H + y] * cosY[j * H + y];
      out[j * AN + i] = (i > 0 ? 2 : 1) * (j > 0 ? 2 : 1) * s * inv;
    }
  }
  return out;
}
