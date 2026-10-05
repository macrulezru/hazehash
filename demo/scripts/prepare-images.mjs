// Picks a varied set of images from the local benchmark set (test-images/, see
// scripts/fetch-test-images.mjs), shrinks them to 600 px on the long side and writes them to
// public/images together with data/images.json (sizes and attribution). The output is committed,
// so this only needs to run when the selection changes.
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = resolve(root, '../test-images');
const outDir = join(root, 'public/images');
const MAX = 600;

// category -> how many images; licences without ShareAlike are preferred.
const plan = {
  landscape: 2,
  'landscape-v': 1,
  'landscape-w': 1,
  portrait: 1,
  'portrait-v': 1,
  city: 1,
  product: 2,
  screenshot: 1,
  graphic: 1,
  alpha: 2,
  food: 1,
  night: 1,
  panorama: 1,
  document: 1,
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      endCell();
    } else if (ch === '\n') {
      endRow();
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell || row.length) endRow();
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const manifest = parseCsv(await readFile(join(source, 'manifest.csv'), 'utf8'));
const allowed = (l) => /^(CC0|Public domain|PD|CC BY (\d|\d\.\d))/i.test(l.trim()) && !/SA/i.test(l);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await mkdir(join(root, 'data'), { recursive: true });

const items = [];
for (const [category, count] of Object.entries(plan)) {
  const candidates = manifest.filter((m) => m.category === category && allowed(m.license));
  // Spread the picks through the category instead of taking the first ones.
  const step = Math.max(1, Math.floor(candidates.length / count));
  for (let k = 0; k < count && k * step < candidates.length; k++) {
    const m = candidates[Math.min(candidates.length - 1, k * step + 1)];
    const hasAlpha = category === 'alpha';
    const name = m.file.replace(/\.(jpg|png)$/i, '') + (hasAlpha ? '.png' : '.jpg');
    const pipeline = sharp(join(source, m.file)).resize(MAX, MAX, {
      fit: 'inside',
      withoutEnlargement: true,
    });
    const info = hasAlpha
      ? await pipeline.png({ compressionLevel: 9, palette: true, quality: 80 }).toFile(join(outDir, name))
      : await pipeline.jpeg({ quality: 78, mozjpeg: true }).toFile(join(outDir, name));
    const { size } = await stat(join(outDir, name));
    items.push({
      file: name,
      category,
      title: m.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
      author: m.author,
      license: m.license,
      licenseUrl: m.license_url,
      sourceUrl: m.source_url,
      width: info.width,
      height: info.height,
      bytes: size,
      hasAlpha,
    });
  }
}

await writeFile(join(root, 'data/images.json'), JSON.stringify(items, null, 2) + '\n');
const total = items.reduce((s, i) => s + i.bytes, 0);
console.log(`${items.length} images, ${(total / 1024).toFixed(0)} KB in total`);
