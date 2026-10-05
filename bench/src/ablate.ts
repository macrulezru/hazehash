/**
 * Ablation study: removes one design choice at a time and reports the mean OKLab error at fixed
 * byte budgets. Usage: pnpm ablate [--limit 120] [--seed 5] [--budgets 20,28]
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { decode } from '../../packages/core/src/decode';
import { encode } from '../../packages/core/src/encode';
import { BASELINE, labRoundtrip, type Variant } from './lab';
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
  for (const f of all) {
    if (items.length >= limit) break;
    const { data, info } = await sharp(join(dir, f))
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // The laboratory codec has no alpha channel: keep opaque images only.
    let opaque = true;
    for (let p = 3; p < data.length; p += 4) {
      if (data[p] < 254) {
        opaque = false;
        break;
      }
    }
    if (opaque) {
      items.push({
        raw: { data: new Uint8Array(data), width: info.width, height: info.height },
        refs: new Map(),
      });
    }
  }
  return items;
}

function refFor(item: Item, w: number, h: number): LinearPremult {
  const key = `${w}x${h}`;
  let ref = item.refs.get(key);
  if (!ref) {
    ref = referenceAt(item.raw, w, h);
    item.refs.set(key, ref);
  }
  return ref;
}

interface Stats {
  dE: number;
  bytes: number;
}

function runVariant(items: Item[], budget: number, v: Variant): Stats {
  let dE = 0;
  let bytes = 0;
  for (const item of items) {
    const res = labRoundtrip(item.raw, budget, v);
    dE += score(refFor(item, res.out.width, res.out.height), toLinearPremult(res.out)).dE;
    bytes += res.size;
  }
  return { dE: dE / items.length, bytes: bytes / items.length };
}

function runCore(items: Item[], budget: number): Stats & { maxPixelDiff: number; labDiff: number } {
  let dE = 0;
  let bytes = 0;
  let maxPixelDiff = 0;
  let labDiff = 0;
  for (const item of items) {
    const enc = encode(item.raw, { budget });
    const out = decode(enc, { size: 32 });
    dE += score(refFor(item, out.width, out.height), toLinearPremult(out)).dE;
    bytes += enc.length;
    const lab = labRoundtrip(item.raw, budget, BASELINE);
    let sum = 0;
    for (let i = 0; i < out.data.length; i++) {
      const d = Math.abs(out.data[i] - lab.out.data[i]);
      maxPixelDiff = Math.max(maxPixelDiff, d);
      sum += d;
    }
    labDiff += sum / out.data.length;
  }
  return {
    dE: dE / items.length,
    bytes: bytes / items.length,
    maxPixelDiff,
    labDiff: labDiff / items.length,
  };
}

async function main(): Promise<void> {
  const limit = Number(arg('limit', '120'));
  const seed = Number(arg('seed', '5'));
  const budgets = arg('budgets', '20,28').split(',').map(Number);
  const items = await load(limit, seed);
  console.log(`Ablation on ${items.length} opaque images, budgets ${budgets.join(', ')}`);

  const variants: Array<{ name: string; what: string; variants: Variant[] }> = [
    { name: 'baseline', what: 'production format', variants: [BASELINE] },
    {
      name: 'mask i/nx+j/ny<1',
      what: 'the narrower triangular mask of the first design',
      variants: [{ ...BASELINE, maskQuarters: 4 }],
    },
    { name: 'rect mask', what: 'full rectangular grid', variants: [{ ...BASELINE, mask: 'rect' }] },
    {
      name: 'banded Qmax',
      what: 'frequency-dependent Qmax bands instead of a flat value',
      variants: [{ ...BASELINE, qmax: 'banded' }],
    },
    {
      name: 'fixed 4 bits',
      what: 'fixed 4 bits per coefficient instead of Golomb-Rice',
      variants: [{ ...BASELINE, entropy: 'fixed4' }],
    },
    {
      name: 'no RDO',
      what: 'plain rounding, only tail truncation to fit',
      variants: [{ ...BASELINE, rdo: false }],
    },
    {
      name: 'single grid',
      what: 'one shared grid for L, a and b',
      variants: [{ ...BASELINE, grids: 'single' }],
    },
    {
      name: "Y'CbCr in sRGB",
      what: "gamma-encoded sRGB (Y'CbCr basis) instead of OKLab",
      variants: [{ ...BASELINE, space: 'ycbcr' }],
    },
  ];

  const lines: string[] = [];
  const header = `| Variant | ${budgets.map((b) => `${b} B: mean dE | vs baseline | bytes`).join(' | ')} |`;
  lines.push(header, `| --- | ${budgets.map(() => '---: | ---: | ---:').join(' | ')} |`);

  const base = new Map<number, Stats>();
  for (const v of variants) {
    const cells: string[] = [];
    for (const budget of budgets) {
      let best: Stats | null = null;
      for (const variant of v.variants) {
        const s = runVariant(items, budget, variant);
        if (!best || s.dE < best.dE) best = s;
      }
      if (v.name === 'baseline') base.set(budget, best!);
      const ref = base.get(budget)!;
      const delta = ((best!.dE - ref.dE) / ref.dE) * 100;
      cells.push(
        `${best!.dE.toFixed(3)} | ${v.name === 'baseline' ? '-' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`} | ${best!.bytes.toFixed(1)}`,
      );
    }
    const row = `| ${v.name} | ${cells.join(' | ')} |`;
    lines.push(row);
    console.log(row);
  }

  const core = runCore(items, budgets[budgets.length - 1]);
  const validation = `Validation: the production codec at ${budgets[budgets.length - 1]} B gives mean dE ${core.dE.toFixed(3)} (${core.bytes.toFixed(1)} B); mean per-channel difference to the laboratory baseline ${core.labDiff.toFixed(3)} levels, max ${core.maxPixelDiff}.`;
  console.log(validation);

  const dir = resolve(ROOT, 'bench/out');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'ablation.md'),
    `# Ablation (${items.length} opaque images, seed ${seed})\n\n${lines.join('\n')}\n\n${variants.map((v) => `- **${v.name}**: ${v.what}`).join('\n')}\n\n${validation}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
