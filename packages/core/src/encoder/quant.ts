/** Encoder-side quantization of DC and AC coefficients. */
import type { Channel } from '../layout';
import { clamp, scaleOf } from '../quant';

/** Rounds to nearest, halves away from zero. */
export function roundHalfAway(v: number): number {
  return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
}

export function dcQuantize(ch: Channel, v: number): number {
  if (ch === 0) return clamp(roundHalfAway(v * 63), 0, 63);
  if (ch === 3) return clamp(roundHalfAway(v * 31), 0, 31);
  return clamp(roundHalfAway(((v + 0.32) / 0.64) * 63), 0, 63);
}

/** Smallest code with s >= maxAbs; code 0 when all AC are zero. */
export function chooseScaleCode(ch: Channel, maxAbs: number): number {
  if (!(maxAbs > 0)) return 0;
  for (let code = 0; code < 15; code++) if (scaleOf(ch, code) >= maxAbs) return code;
  return 15;
}

/** Level nearest to the ideal value (in the square-root domain). */
export function quantizeAc(c: number, s: number, qmax: number): number {
  const a = Math.abs(c) / s;
  const u = Math.sqrt(a > 1 ? 1 : a);
  const q = roundHalfAway(u * qmax);
  return c < 0 ? -q : q;
}
