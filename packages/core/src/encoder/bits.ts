/** Bit writer, MSB first, and Golomb-Rice code lengths. */
export class BitWriter {
  private buf: number[] = [];
  private cur = 0;
  private n = 0; // bits held in cur

  bit(b: number): void {
    this.cur = (this.cur << 1) | b;
    if (++this.n === 8) {
      this.buf.push(this.cur);
      this.cur = 0;
      this.n = 0;
    }
  }

  /** Writes the low `count` bits of `value`, most significant first (count <= 31). */
  bits(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bit((value >>> i) & 1);
  }

  get bitLength(): number {
    return this.buf.length * 8 + this.n;
  }

  /** Bytes with the tail padded with zeros. */
  finish(): Uint8Array {
    const out = this.buf.slice();
    if (this.n > 0) out.push(this.cur << (8 - this.n));
    return Uint8Array.from(out);
  }
}

/** Signed to unsigned: 2q for q >= 0, otherwise -2q - 1. */
export function zigzag(q: number): number {
  return q >= 0 ? 2 * q : -2 * q - 1;
}

/** Length in bits of the Rice code of q with parameter k. */
export function riceLength(q: number, k: number): number {
  return (zigzag(q) >> k) + 1 + k;
}

export function writeRice(w: BitWriter, q: number, k: number): void {
  const n = zigzag(q);
  for (let t = n >> k; t > 0; t--) w.bit(1);
  w.bit(0);
  if (k > 0) w.bits(n & ((1 << k) - 1), k);
}
