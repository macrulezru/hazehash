/** Micro-benchmark of encoder/decoder timings against the performance targets. */
import { decode, getAspectRatio, getAverageColor } from '../../packages/core/src/decode';
import { encode } from '../../packages/core/src/encode';
import type { RgbaImage } from '../../packages/core/src/types';

function scene(w: number, h: number, seed: number, alpha = false): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const blobs = Array.from({ length: 6 }, () => [
    rnd(),
    rnd(),
    0.1 + rnd() * 0.3,
    rnd(),
    rnd(),
    rnd(),
  ]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const px = [u, v, 1 - u * 0.5];
      for (const [bx, by, r, a, b, c] of blobs) {
        const d = Math.hypot(u - bx, v - by) / r;
        if (d < 1) {
          px[0] = px[0] * d + a * (1 - d);
          px[1] = px[1] * d + b * (1 - d);
          px[2] = px[2] * d + c * (1 - d);
        }
      }
      const o = (y * w + x) * 4;
      data[o] = px[0] * 255;
      data[o + 1] = px[1] * 255;
      data[o + 2] = px[2] * 255;
      data[o + 3] = alpha ? Math.max(0, Math.min(255, 400 - u * 400)) : 255;
    }
  }
  return { data, width: w, height: h };
}

function median(fn: () => void, runs: number): number {
  for (let i = 0; i < Math.min(5, runs); i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

const small = Array.from({ length: 8 }, (_, i) => scene(64, 48, i + 1));
const big = scene(1920, 1080, 99);
const alphaSmall = scene(64, 48, 7, true);
let k = 0;
const next = () => small[k++ % small.length];

for (const profile of ['fast', 'default', 'high'] as const) {
  const t64 = median(() => encode(next(), { profile }), 60);
  const tBig = median(() => encode(big, { profile }), 8);
  const tAlpha = median(() => encode(alphaSmall, { profile }), 20);
  console.log(
    `encode ${profile.padEnd(7)} 64x48: ${t64.toFixed(2)} ms   1920x1080: ${tBig.toFixed(1)} ms   64x48+alpha: ${tAlpha.toFixed(1)} ms`,
  );
}

const hash = encode(small[0]);
const first = (() => {
  const t = performance.now();
  decode(hash);
  return performance.now() - t;
})();
console.log(`decode 32x32 first call: ${first.toFixed(2)} ms`);
console.log(`decode 32x32 repeat: ${median(() => decode(hash), 400).toFixed(3)} ms`);
console.log(
  `getAverageColor+getAspectRatio: ${median(() => {
    getAverageColor(hash);
    getAspectRatio(hash);
  }, 2000).toFixed(4)} ms`,
);
