import type { RgbaImage } from '../src/types';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function solid(w: number, h: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { data, width: w, height: h };
}

/** Smooth synthetic scene: gradients plus a few blobs; optional alpha falloff. */
export function scene(w: number, h: number, seed: number, withAlpha = false): RgbaImage {
  const rand = rng(seed);
  const blobs = Array.from({ length: 4 }, () => ({
    x: rand(),
    y: rand(),
    r: 0.1 + rand() * 0.3,
    c: [rand() * 255, rand() * 255, rand() * 255],
  }));
  const base = [rand() * 255, rand() * 255, rand() * 255];
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      const px = [base[0] * u, base[1] * v, base[2] * (1 - u * 0.5)];
      for (const b of blobs) {
        const d = Math.hypot(u - b.x, v - b.y) / b.r;
        if (d < 1) for (let c = 0; c < 3; c++) px[c] = px[c] * d + b.c[c] * (1 - d);
      }
      const o = (y * w + x) * 4;
      data[o] = px[0];
      data[o + 1] = px[1];
      data[o + 2] = px[2];
      data[o + 3] = withAlpha ? Math.round(255 * Math.min(1, Math.max(0, 1.4 - u * 1.4))) : 255;
    }
  }
  return { data, width: w, height: h };
}

export function noise(w: number, h: number, seed: number): RgbaImage {
  const rand = rng(seed);
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rand() * 256);
  return { data, width: w, height: h };
}
