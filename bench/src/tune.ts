/**
 * Parameter tuning harness: greedy coordinate sweeps over the format constants, scored by mean
 * OKLab error on a fixed random subset. Usage: pnpm tune [--limit 120] [--seed 5] [--budgets 20,28]
 */
import { readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { decode } from '../../packages/core/src/decode';
import { encode } from '../../packages/core/src/encode';
import { codeToAspect, outputSize, readHeader } from '../../packages/core/src/format';
import { resetOrderCache } from '../../packages/core/src/encode';
import { DEFAULT_PARAMS, PARAMS, type Params } from '../../packages/core/src/params';
import { referenceAt, score, toLinearPremult, type LinearPremult, type Raw } from './metrics';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Item {
  raw: Raw;
  refs: Map<string, LinearPremult>;
}

interface Config {
  params: Partial<Params>;
  wL: number;
}

async function load(limit: number, seed: number): Promise<Item[]> {
  const dir = join(ROOT, 'test-images');
  const all = (await readdir(dir))
    .filter((f) => ['.jpg', '.png'].includes(extname(f).toLowerCase()))
    .sort();
  const rand = mulberry32(seed);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const items: Item[] = [];
  for (const f of all.slice(0, limit)) {
    const { data, info } = await sharp(join(dir, f))
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    items.push({
      raw: { data: new Uint8Array(data), width: info.width, height: info.height },
      refs: new Map(),
    });
  }
  return items;
}

function evaluate(items: Item[], budgets: number[], cfg: Config): { dE: number; ssim: number } {
  Object.assign(PARAMS, DEFAULT_PARAMS, cfg.params);
  resetOrderCache();
  let dE = 0;
  let ssim = 0;
  let n = 0;
  for (const item of items) {
    for (const budget of budgets) {
      const bytes = encode(item.raw, { budget, weights: { L: cfg.wL } });
      const [w, h] = outputSize(codeToAspect(readHeader(bytes).aspectCode), 32);
      const key = `${w}x${h}`;
      let ref = item.refs.get(key);
      if (!ref) {
        ref = referenceAt(item.raw, w, h);
        item.refs.set(key, ref);
      }
      const s = score(ref, toLinearPremult(decode(bytes, { size: 32 })));
      dE += s.dE;
      ssim += s.ssim;
      n++;
    }
  }
  return { dE: dE / n, ssim: ssim / n };
}

type Sweep = { name: string; options: Array<Partial<Params> & { wL?: number }> };

const sweeps: Sweep[] = [
  { name: 'tolLuma', options: [{ tolLuma: 3.5 }, { tolLuma: 5 }, { tolLuma: 9 }] },
  { name: 'tolChroma', options: [{ tolChroma: 6 }, { tolChroma: 9 }] },
  { name: 'qmaxL', options: [{ qmaxL: 5 }, { qmaxL: 6 }, { qmaxL: 8 }, { qmaxL: 9 }] },
  { name: 'qmaxC', options: [{ qmaxC: 2 }, { qmaxC: 4 }, { qmaxC: 5 }] },
  { name: 'wL', options: [{ wL: 0.7 }, { wL: 1.3 }] },
  { name: 'smaxL', options: [{ smaxL: 0.5 }, { smaxL: 0.8 }] },
  { name: 'smaxC', options: [{ smaxC: 0.25 }, { smaxC: 0.4 }] },
  { name: 'reconOffset', options: [{ reconOffset: -0.1 }, { reconOffset: 0.1 }] },
];

async function main(): Promise<void> {
  const limit = Number(arg('limit', '120'));
  const seed = Number(arg('seed', '5'));
  const budgets = arg('budgets', '20,28').split(',').map(Number);
  const items = await load(limit, seed);
  console.log(`Tuning on ${items.length} images, budgets ${budgets.join(',')}`);

  let best: Config = JSON.parse(arg('start', '{"params":{},"wL":1}')) as Config;
  let bestScore = evaluate(items, budgets, best);
  console.log(`baseline dE=${bestScore.dE.toFixed(4)} ssim=${bestScore.ssim.toFixed(4)}`);

  if (process.argv.includes('--baseline-only')) return;

  for (const sweep of sweeps) {
    let winner: Config | null = null;
    for (const opt of sweep.options) {
      const { wL, ...params } = opt;
      const cfg: Config = { params: { ...best.params, ...params }, wL: wL ?? best.wL };
      const s = evaluate(items, budgets, cfg);
      const mark = s.dE < bestScore.dE - 1e-4 ? '*' : ' ';
      console.log(
        `${mark} ${sweep.name} ${JSON.stringify(opt)} dE=${s.dE.toFixed(4)} ssim=${s.ssim.toFixed(4)}`,
      );
      if (s.dE < bestScore.dE - 1e-4) {
        bestScore = s;
        winner = cfg;
      }
    }
    if (winner) best = winner;
  }
  console.log('BEST', JSON.stringify(best), `dE=${bestScore.dE.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
