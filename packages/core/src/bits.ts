/** Bit reader, MSB first. A bit past the end of the data reads as 0. */
export class BitReader {
  private pos: number;
  private readonly end: number;

  constructor(
    private readonly bytes: Uint8Array,
    byteOffset = 0,
  ) {
    this.pos = byteOffset * 8;
    this.end = bytes.length * 8;
  }

  bit(): number {
    if (this.pos >= this.end) return 0;
    const p = this.pos++;
    return (this.bytes[p >> 3] >> (7 - (p & 7))) & 1;
  }

  bits(count: number): number {
    let v = 0;
    for (let i = 0; i < count; i++) v = (v << 1) | this.bit();
    return v >>> 0;
  }
}

export function readRice(r: BitReader, k: number): number {
  let u = 0;
  while (r.bit() === 1) u++;
  const n = u * (1 << k) + (k > 0 ? r.bits(k) : 0);
  return n & 1 ? -((n + 1) / 2) : n / 2;
}
