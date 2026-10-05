import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { blur, haze, thumb, type CodecResult, type SourceImages } from './codecs';
import { referenceAt, score, toLinearPremult, type Raw, type Score } from './metrics';
import { buildReport, type Row, type SheetItem } from './report';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
/** Relative user paths are resolved against the directory the command was started from. */
const CALLER = process.env.INIT_CWD ?? process.cwd();

interface Args {
  images: string;
  budgets: number[];
  limit: number;
  seed: number;
  out: string;
  profile: 'fast' | 'default' | 'high';
  sheetBudget: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    images: join(ROOT, 'test-images'),
    budgets: [16, 20, 24, 28, 36, 48],
    limit: 0,
    seed: 1,
    out: join(ROOT, 'bench/out'),
    profile: 'default',
    sheetBudget: 28,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const value = inline ?? argv[++i];
    if (flag === '--images') args.images = resolve(CALLER, value);
    else if (flag === '--budgets') args.budgets = value.split(',').map(Number);
    else if (flag === '--limit') args.limit = Number(value);
    else if (flag === '--seed') args.seed = Number(value);
    else if (flag === '--out') args.out = resolve(CALLER, value);
    else if (flag === '--profile') args.profile = value as Args['profile'];
    else if (flag === '--sheet-budget') args.sheetBudget = Number(value);
    else throw new Error(`Unknown argument ${flag}`);
  }
  return args;
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

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Image files of the set; sub-directories whose name starts with "_" are skipped. */
async function listImages(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('_')) out.push(...(await listImages(join(dir, entry.name))));
    } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(extname(entry.name).toLowerCase())) {
      out.push(join(dir, entry.name));
    }
  }
  return out.sort();
}

async function loadRaw(pipeline: sharp.Sharp): Promise<Raw> {
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

async function loadSources(file: string): Promise<SourceImages> {
  const full = await loadRaw(sharp(file));
  const small100 = await loadRaw(sharp(file).resize(100, 100, { fit: 'inside' }));
  const small64 = await loadRaw(
    sharp(file).resize(64, 64, { fit: 'inside' }).flatten({ background: '#ffffff' }),
  );
  return { full, small100, small64 };
}

function categoryOf(file: string): string {
  const name = file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  return name.replace(/-\d+$/, '');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.images);
  let files = await listImages(dir);
  if (args.limit > 0 && args.limit < files.length) {
    files = shuffle(files, mulberry32(args.seed)).slice(0, args.limit).sort();
  }
  console.log(`Images: ${files.length} (${dir}), budgets: ${args.budgets.join(', ')}`);

  const rows: Row[] = [];
  const sheetData = new Map<string, { raws: Record<string, Raw>; scores: Record<string, Score> }>();

  for (let n = 0; n < files.length; n++) {
    const file = files[n];
    const name = file.replace(/^.*[\\/]/, '');
    const src = await loadSources(file);
    const refCache = new Map<string, ReturnType<typeof referenceAt>>();
    const evaluate = (codec: string, budget: number, res: CodecResult): Score => {
      const key = `${res.out.width}x${res.out.height}`;
      let ref = refCache.get(key);
      if (!ref) {
        ref = referenceAt(src.full, res.out.width, res.out.height);
        refCache.set(key, ref);
      }
      const s = score(ref, toLinearPremult(res.out));
      rows.push({
        file: name,
        category: categoryOf(name),
        codec,
        budget,
        bytes: res.bytes,
        ...s,
        encMs: res.encMs,
        decMs: res.decMs,
      });
      return s;
    };

    const record: { raws: Record<string, Raw>; scores: Record<string, Score> } = {
      raws: {},
      scores: {},
    };
    const keep = (codec: string, budget: number, res: CodecResult, s: Score) => {
      if (budget === args.sheetBudget || codec === 'thumbhash') {
        record.raws[codec] = res.out;
        record.scores[codec] = s;
      }
    };

    const t = thumb(src);
    keep('thumbhash', 0, t, evaluate('thumbhash', 0, t));
    for (const budget of args.budgets) {
      const h = haze(src, budget, { profile: args.profile });
      keep('hazehash', budget, h, evaluate('hazehash', budget, h));
      const b = blur(src, budget);
      keep('blurhash', budget, b, evaluate('blurhash', budget, b));
    }
    sheetData.set(file, record);
    if ((n + 1) % 25 === 0 || n + 1 === files.length) console.log(`  ${n + 1}/${files.length}`);
  }

  // Contact sheet: 60 random images plus the 20 worst by HazeHash error.
  const rand = mulberry32(args.seed + 1000);
  const worst = [...sheetData.entries()]
    .filter(([, r]) => r.scores.hazehash)
    .sort((p, q) => q[1].scores.hazehash.dE - p[1].scores.hazehash.dE)
    .slice(0, 20)
    .map(([f]) => f);
  const randomPick = shuffle(
    files.filter((f) => !worst.includes(f)),
    rand,
  ).slice(0, 60);

  const toItem = async (file: string, kind: 'random' | 'worst'): Promise<SheetItem> => {
    const rec = sheetData.get(file)!;
    const original = await sharp(file)
      .resize(96, 96, { fit: 'inside' })
      .flatten({ background: '#cccccc' })
      .jpeg({ quality: 70 })
      .toBuffer();
    const previews: Record<string, string> = {};
    for (const [codec, raw] of Object.entries(rec.raws)) {
      const png = await sharp(Buffer.from(raw.data), {
        raw: { width: raw.width, height: raw.height, channels: 4 },
      })
        .resize(raw.width * 3, raw.height * 3, { kernel: 'cubic' })
        .png()
        .toBuffer();
      previews[codec] = `data:image/png;base64,${png.toString('base64')}`;
    }
    return {
      file: file.replace(/^.*[\\/]/, ''),
      kind,
      original: `data:image/jpeg;base64,${original.toString('base64')}`,
      previews,
      dE: Object.fromEntries(Object.entries(rec.scores).map(([c, s]) => [c, s.dE])),
    };
  };
  const sheet = [
    ...(await Promise.all(randomPick.map((f) => toItem(f, 'random')))),
    ...(await Promise.all(worst.map((f) => toItem(f, 'worst')))),
  ];

  await mkdir(resolve(args.out), { recursive: true });
  const { csv, summaryCsv, html, summaryText } = buildReport(rows, sheet, args.budgets, {
    profile: args.profile,
    images: files.length,
  });
  await writeFile(join(resolve(args.out), 'results.csv'), csv);
  await writeFile(join(resolve(args.out), 'summary.csv'), summaryCsv);
  await writeFile(join(resolve(args.out), 'report.html'), html);
  console.log(summaryText);
  console.log(`Report written to ${resolve(args.out)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
