/**
 * Fuzzing: decoder on random inputs (valid result or PlaceholderError, never a hang or a slow
 * call) and encoder on random images and budgets (length within budget, decodable output).
 * Usage: tsx scripts/fuzz.ts [decoderRuns=1000000] [encoderRuns=3000]
 */
import { decode } from '../src/decode';
import { encode } from '../src/encode';
import { PlaceholderError } from '../src/errors';
import { noise, rng, scene } from '../test/helpers';

const decoderRuns = Number(process.argv[2] ?? 1_000_000);
const encoderRuns = Number(process.argv[3] ?? 3000);
const rand = rng(20261004);

let ok = 0;
let rejected = 0;
let slowest = 0;
let failures = 0;
const reject = (msg: string) => {
  failures++;
  if (failures <= 10) console.error(msg);
};

for (let i = 0; i < decoderRuns; i++) {
  const len = Math.floor(rand() * 1101);
  const bytes = new Uint8Array(len);
  // Half of the inputs get a valid first byte so most of them pass the header checks.
  for (let b = 0; b < len; b++) bytes[b] = Math.floor(rand() * 256);
  if (i % 2 === 0 && len > 0) bytes[0] &= 0x3f;
  const t = performance.now();
  try {
    const img = decode(bytes);
    if (img.data.length !== img.width * img.height * 4) reject(`bad output size at run ${i}`);
    ok++;
  } catch (e) {
    if (e instanceof PlaceholderError) rejected++;
    else reject(`unexpected error at run ${i}: ${String(e)}`);
  }
  const dt = performance.now() - t;
  if (dt > slowest) slowest = dt;
  if (dt > 5 && i > 1000) {
    // A single spike is usually a GC pause: only a repeatable slowdown counts.
    const t2 = performance.now();
    try {
      decode(bytes);
    } catch {
      // rejected inputs are fast by construction
    }
    const again = performance.now() - t2;
    if (again > 5) reject(`slow decode (${again.toFixed(1)} ms) at run ${i}, length ${len}`);
  }
}
console.log(
  `decoder: ${decoderRuns} runs, ${ok} decoded, ${rejected} rejected, slowest ${slowest.toFixed(2)} ms`,
);

let encoded = 0;
for (let i = 0; i < encoderRuns; i++) {
  const w = 1 + Math.floor(rand() * 120);
  const h = 1 + Math.floor(rand() * 120);
  const budget = 7 + Math.floor(rand() * 60);
  const kind = i % 4;
  const img = kind === 0 ? noise(w, h, i) : scene(w, h, i, kind === 1);
  try {
    const bytes = encode(img, { budget, profile: (['fast', 'default', 'high'] as const)[i % 3] });
    if (bytes.length > budget) reject(`encoder exceeded budget ${budget}: ${bytes.length}`);
    decode(bytes);
    const again = encode(img, { budget, profile: (['fast', 'default', 'high'] as const)[i % 3] });
    if (again.length !== bytes.length || again.some((v, j) => v !== bytes[j])) {
      reject(`non-deterministic encode at run ${i}`);
    }
    encoded++;
  } catch (e) {
    // The only legitimate failure: the budget cannot hold even the header (alpha needs 9 bytes).
    if (!(e instanceof PlaceholderError && e.code === 'BudgetTooSmall' && budget < 9)) {
      reject(`encoder failed at run ${i} (${w}x${h}, budget ${budget}): ${String(e)}`);
    }
  }
}
console.log(`encoder: ${encoderRuns} runs, ${encoded} encoded and decoded`);
console.log(failures === 0 ? 'fuzz: OK' : `fuzz: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
