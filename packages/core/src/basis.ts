/** DCT-II cosine basis sampled at pixel centers over the unit square. */

const cache = new Map<number, Float64Array>();

/** cos[i·size + x] = cos(π·i·(x + 0.5)/size) for i < count. */
export function cosTable(count: number, size: number): Float64Array {
  const key = count * 4096 + size;
  let t = cache.get(key);
  if (!t) {
    t = new Float64Array(count * size);
    for (let i = 0; i < count; i++) {
      for (let x = 0; x < size; x++) t[i * size + x] = Math.cos((Math.PI * i * (x + 0.5)) / size);
    }
    cache.set(key, t);
  }
  return t;
}

/** Separable synthesis: c[j·stride + i], i < nx, j < ny -> plane of Wo×Ho. */
export function synthesize(
  c: Float64Array,
  stride: number,
  nx: number,
  ny: number,
  Wo: number,
  Ho: number,
  plane: Float64Array,
): void {
  const cosX = cosTable(nx, Wo);
  const cosY = cosTable(ny, Ho);
  const row = new Float64Array(nx);
  for (let y = 0; y < Ho; y++) {
    for (let i = 0; i < nx; i++) {
      let t = 0;
      for (let j = 0; j < ny; j++) {
        const v = c[j * stride + i];
        if (v !== 0) t += v * cosY[j * Ho + y];
      }
      row[i] = t;
    }
    for (let x = 0; x < Wo; x++) {
      let v = 0;
      for (let i = 0; i < nx; i++) v += row[i] * cosX[i * Wo + x];
      plane[y * Wo + x] = v;
    }
  }
}
