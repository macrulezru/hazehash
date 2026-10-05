/** sRGB transfer curve and OKLab (matrices by Björn Ottosson), decoder direction. */

export type Triple = number[] | Float64Array;

export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function oklabToLinear(L: number, a: number, b: number, out: Triple): void {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
}

const TOL_LO = -0.0005;
const TOL_HI = 1.0005;
const tmp = [0, 0, 0];

function inTolerance(c: number[]): boolean {
  return (
    c[0] >= TOL_LO &&
    c[0] <= TOL_HI &&
    c[1] >= TOL_LO &&
    c[1] <= TOL_HI &&
    c[2] >= TOL_LO &&
    c[2] <= TOL_HI
  );
}

/**
 * OKLab to linear RGB in [0, 1] with gamut mapping by chroma reduction
 * (8 bisection steps). L must already be clamped to [0, 1].
 */
export function oklabToGamutLinear(L: number, a: number, b: number, out: number[]): void {
  oklabToLinear(L, a, b, out);
  if (!inTolerance(out)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 8; i++) {
      const t = (lo + hi) / 2;
      oklabToLinear(L, a * t, b * t, tmp);
      if (inTolerance(tmp)) lo = t;
      else hi = t;
    }
    oklabToLinear(L, a * lo, b * lo, out);
  }
  for (let i = 0; i < 3; i++) out[i] = out[i] < 0 ? 0 : out[i] > 1 ? 1 : out[i];
}
