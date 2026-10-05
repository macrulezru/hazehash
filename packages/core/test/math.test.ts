import { describe, expect, it } from 'vitest';
import { cosTable, synthesize } from '../src/basis';
import { AN, analyze } from '../src/encoder/analysis';
import { linearToSrgb, oklabToLinear } from '../src/color';
import { linearToOklab, srgbToLinear } from '../src/encoder/color';
import { buildOrder, inMask, qmaxOf } from '../src/layout';

describe('color', () => {
  it('round-trips sRGB <-> linear', () => {
    for (let i = 0; i <= 255; i++) {
      expect(Math.abs(linearToSrgb(srgbToLinear(i / 255)) - i / 255)).toBeLessThan(1e-9);
    }
  });

  it('round-trips linear <-> OKLab', () => {
    const lab = [0, 0, 0];
    const back = [0, 0, 0];
    for (let r = 0; r <= 1; r += 0.125) {
      for (let g = 0; g <= 1; g += 0.125) {
        for (let b = 0; b <= 1; b += 0.125) {
          linearToOklab(r, g, b, lab);
          oklabToLinear(lab[0], lab[1], lab[2], back);
          expect(Math.abs(back[0] - r)).toBeLessThan(1e-6);
          expect(Math.abs(back[1] - g)).toBeLessThan(1e-6);
          expect(Math.abs(back[2] - b)).toBeLessThan(1e-6);
        }
      }
    }
  });
});

describe('basis', () => {
  it('is orthogonal on the pixel grid', () => {
    const W = 13;
    const H = 9;
    const cx = cosTable(8, W);
    const cy = cosTable(8, H);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        for (let k = 0; k < 6; k++) {
          for (let l = 0; l < 6; l++) {
            if (i === k && j === l) continue;
            let dot = 0;
            for (let x = 0; x < W; x++) {
              for (let y = 0; y < H; y++) {
                dot += cx[i * W + x] * cy[j * H + y] * cx[k * W + x] * cy[l * H + y];
              }
            }
            expect(Math.abs(dot / (W * H))).toBeLessThan(1e-12);
          }
        }
      }
    }
  });

  it('reproduces a flat image exactly', () => {
    const W = 17;
    const H = 11;
    const plane = new Float64Array(W * H).fill(0.37);
    const c = analyze(plane, W, H, 8, 8);
    expect(c[0]).toBeCloseTo(0.37, 12);
    for (let k = 1; k < AN * AN; k++) expect(Math.abs(c[k])).toBeLessThan(1e-12);
    const out = new Float64Array(W * H);
    synthesize(c, AN, 8, 8, W, H, out);
    for (const v of out) expect(Math.abs(v - 0.37)).toBeLessThan(1e-9);
  });

  it('maps a pure cosine to exactly one coefficient', () => {
    const W = 32;
    const H = 24;
    const plane = new Float64Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        plane[y * W + x] =
          0.2 * Math.cos((Math.PI * 3 * (x + 0.5)) / W) * Math.cos((Math.PI * 2 * (y + 0.5)) / H);
      }
    }
    const c = analyze(plane, W, H, 8, 8);
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        if (i === 3 && j === 2) expect(c[j * AN + i]).toBeCloseTo(0.2, 10);
        else expect(Math.abs(c[j * AN + i])).toBeLessThan(1e-10);
      }
    }
  });
});

/** Independent ordering oracle using exact rational comparison. */
function oracleOrder(grids: { Lx: number; Ly: number; Cx: number; Cy: number }) {
  const items: Array<{ ch: number; i: number; j: number; num: bigint; den: bigint }> = [];
  const dims = [
    [grids.Lx, grids.Ly],
    [grids.Cx, grids.Cy],
    [grids.Cx, grids.Cy],
  ];
  dims.forEach(([nx, ny], ch) => {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        if (i === 0 && j === 0) continue;
        if (2 * (i * ny + j * nx) >= 3 * nx * ny) continue;
        items.push({
          ch,
          i,
          j,
          num: BigInt(i * i * ny * ny + j * j * nx * nx),
          den: BigInt(nx * nx * ny * ny),
        });
      }
    }
  });
  items.sort((p, q) => {
    const d = p.num * q.den - q.num * p.den;
    if (d !== 0n) return d < 0n ? -1 : 1;
    return p.ch - q.ch || p.j - q.j || p.i - q.i;
  });
  return items.map((e) => `${e.ch}:${e.i}:${e.j}`);
}

describe('layout', () => {
  it('counts AC coefficients of square grids', () => {
    const expected = [0, 3, 8, 14, 23, 32, 45, 57];
    expected.forEach((count, idx) => {
      const n = idx + 1;
      const order = buildOrder({ Lx: n, Ly: n, Cx: 1, Cy: 1, alpha: false, Ax: 1, Ay: 1 });
      expect(order.length).toBe(count);
    });
  });

  it('orders luma 3x3 by frequency radius', () => {
    const order = buildOrder({ Lx: 3, Ly: 3, Cx: 1, Cy: 1, alpha: false, Ax: 1, Ay: 1 });
    expect(order.map((e) => [e.i, e.j])).toEqual([
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 0],
      [0, 2],
      [2, 1],
      [1, 2],
      [2, 2],
    ]);
  });

  it('matches the independent oracle on all grids 1x1..8x8', () => {
    for (let Lx = 1; Lx <= 8; Lx++) {
      for (let Ly = 1; Ly <= 8; Ly++) {
        for (let Cx = 1; Cx <= Math.min(4, Lx); Cx++) {
          for (let Cy = 1; Cy <= Math.min(4, Ly); Cy++) {
            const got = buildOrder({ Lx, Ly, Cx, Cy, alpha: false, Ax: 1, Ay: 1 }).map(
              (e) => `${e.ch}:${e.i}:${e.j}`,
            );
            expect(got).toEqual(oracleOrder({ Lx, Ly, Cx, Cy }));
          }
        }
      }
    }
  });

  it('uses a flat Qmax per channel type', () => {
    expect(qmaxOf(0)).toBe(7);
    expect(qmaxOf(1)).toBe(3);
    expect(qmaxOf(2)).toBe(3);
    expect(qmaxOf(3)).toBe(3);
  });

  it('keeps coefficients with i/nx + j/ny < 1.5', () => {
    expect(inMask(2, 0, 3, 3)).toBe(true);
    expect(inMask(2, 2, 3, 3)).toBe(true); // 4/3 < 1.5
    expect(inMask(3, 3, 4, 4)).toBe(false); // exactly 1.5
    expect(inMask(1, 0, 8, 1)).toBe(true);
    expect(inMask(7, 7, 8, 8)).toBe(false);
  });
});
