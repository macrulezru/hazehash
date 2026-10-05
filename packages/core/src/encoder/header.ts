/** Header writing and aspect ratio coding. */
import type { Header } from '../format';
import { clamp } from '../quant';
import type { BitWriter } from './bits';
import { roundHalfAway } from './quant';

export function aspectToCode(r: number): number {
  return clamp(roundHalfAway(8 * Math.log2(r)) + 32, 0, 63);
}

export function writeHeader(w: BitWriter, h: Header): void {
  w.bits(0, 2);
  w.bits(h.alpha ? 1 : 0, 1);
  w.bits(h.aspectCode, 6);
  w.bits(h.Lx - 1, 3);
  w.bits(h.Ly - 1, 3);
  w.bits(h.Cx - 1, 2);
  w.bits(h.Cy - 1, 2);
  for (let c = 0; c < 3; c++) w.bits(h.dc[c], 6);
  for (let c = 0; c < 3; c++) w.bits(h.scale[c], 4);
  for (let c = 0; c < 3; c++) w.bits(h.k[c], 2);
  w.bits(0, 1);
  if (h.alpha) {
    w.bits(h.dc[3], 5);
    w.bits(h.Ax - 1, 2);
    w.bits(h.Ay - 1, 2);
    w.bits(h.scale[3], 4);
    w.bits(h.k[3], 2);
    w.bits(0, 1);
  }
}
