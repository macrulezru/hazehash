/** sRGB transfer curve and OKLab, encoder direction. */
import type { Triple } from '../color';

export function srgbToLinear(u: number): number {
  return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
}

const LIN_LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) LIN_LUT[i] = srgbToLinear(i / 255);

/** Linearizes an 8-bit value via a lookup table. */
export function srgb8ToLinear(u8: number): number {
  return LIN_LUT[u8];
}

export function linearToOklab(r: number, g: number, b: number, out: Triple): void {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}
