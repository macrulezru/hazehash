/**
 * Generates test/vectors/v1.json: pairs of "hash -> decoded pixels" for decoder conformance.
 * Run once before the format freeze. The file is frozen after release and this script refuses
 * to overwrite it unless --force is given.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/decode';
import { encode } from '../src/encode';
import { BitWriter, writeRice } from '../src/encoder/bits';
import { toBase64Url } from '../src/encoder/base64';
import { writeHeader } from '../src/encoder/header';
import type { Header } from '../src/format';
import { noise, rng, scene, solid } from '../test/helpers';

const SIZE = 16;
const out = join(dirname(fileURLToPath(import.meta.url)), '../test/vectors/v1.json');
if (existsSync(out) && !process.argv.includes('--force')) {
  console.error(`${out} already exists and is frozen; pass --force to overwrite.`);
  process.exit(1);
}

interface Vector {
  name: string;
  hash: string;
  size: number;
  /** Decoded RGBA, base64. */
  rgba: string;
}

const vectors: Vector[] = [];
const add = (name: string, bytes: Uint8Array) => {
  const hash = toBase64Url(bytes);
  const img = decode(hash, { size: SIZE });
  vectors.push({
    name,
    hash,
    size: SIZE,
    rgba: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength).toString('base64'),
  });
};

// 1. The hand-computed flat gray square.
add('flat-gray', Uint8Array.from([0x10, 0x00, 0x10, 0x3e, 0xf8, 0x00, 0x00]));

// 2. Encoder output across aspect ratios, budgets and alpha.
const shapes: Array<[string, number, number]> = [
  ['square', 64, 64],
  ['landscape-4x3', 80, 60],
  ['wide-16x9', 96, 54],
  ['panorama-6x1', 180, 30],
  ['tall-1x3', 30, 90],
  ['extreme-wide-50x1', 500, 10],
  ['extreme-tall-1x50', 10, 500],
];
shapes.forEach(([name, w, h], idx) => {
  add(`enc-${name}-28`, encode(scene(w, h, 100 + idx)));
});
for (const budget of [8, 12, 16, 20, 36, 48]) {
  add(`enc-budget-${budget}`, encode(scene(72, 54, 7), { budget }));
}
shapes.slice(0, 4).forEach(([name, w, h], idx) => {
  add(`enc-alpha-${name}`, encode(scene(w, h, 200 + idx, true)));
});
add('enc-transparent', encode(solid(20, 20, [200, 30, 30, 0])));
add('enc-white', encode(solid(20, 20, [255, 255, 255, 255])));
add('enc-black', encode(solid(20, 20, [0, 0, 0, 255])));
add('enc-saturated-red', encode(solid(20, 20, [255, 0, 0, 255])));
add('enc-noise', encode(noise(64, 64, 3)));
add('enc-high-profile', encode(scene(64, 48, 11), { profile: 'high' }));

// 3. Truncated strings: every second prefix of one longer hash.
const long = encode(scene(64, 48, 13), { budget: 40 });
for (const len of [7, 9, 12, 17, 25, long.length]) add(`truncated-${len}`, long.subarray(0, len));

// 4. Crafted streams: valid headers with pseudo-random Rice data, covering every Rice parameter
// k and a spread of scale codes, grid sizes and alpha.
const rand = rng(2026);
const pick = (n: number) => Math.floor(rand() * n);
for (let i = 0; i < 28; i++) {
  const alpha = i % 3 === 0;
  const k = i % 4;
  const header: Header = {
    aspectCode: pick(64),
    alpha,
    Lx: 1 + pick(8),
    Ly: 1 + pick(8),
    Cx: 1 + pick(4),
    Cy: 1 + pick(4),
    Ax: alpha ? 1 + pick(4) : 1,
    Ay: alpha ? 1 + pick(4) : 1,
    dc: [pick(64), pick(64), pick(64), alpha ? pick(32) : 0],
    scale: [pick(16), pick(16), pick(16), alpha ? pick(16) : 0],
    k: [k, (k + 1) % 4, (k + 2) % 4, alpha ? (k + 3) % 4 : 0],
  };
  const w = new BitWriter();
  writeHeader(w, header);
  const count = 10 + pick(60);
  for (let c = 0; c < count; c++) writeRice(w, pick(9) - 4, header.k[c % (alpha ? 4 : 3)]);
  add(`crafted-${i}-k${k}${alpha ? '-alpha' : ''}`, w.finish());
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ format: 1, tolerance: 1, vectors }, null, 1) + '\n');
console.log(`Wrote ${vectors.length} vectors to ${out}`);
