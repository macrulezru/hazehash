#!/usr/bin/env node
/**
 * fetch-test-images.mjs
 *
 * Скачивает свободно лицензированные тестовые изображения из Wikimedia Commons
 * в ../test-images и ведёт manifest.csv (автор, лицензия, ссылка на источник).
 * Без зависимостей, нужен Node.js 18+.
 *
 * Запуск (из папки hazehash):
 *   node scripts/fetch-test-images.mjs --dry-run          # только подсчёт кандидатов
 *   node scripts/fetch-test-images.mjs --limit 2          # пробный запуск, по 2 файла на категорию
 *   node scripts/fetch-test-images.mjs                    # полный набор (~500 файлов)
 *   node scripts/fetch-test-images.mjs --category alpha   # одна категория (и её подкатегории)
 *
 * Параметры: --out <папка>  --width 1280  --limit N  --delay 300 (мс между запросами)
 *            --no-sa (без CC BY-SA)  --contact "почта или сайт"  --api <url>  --help
 * Повторный запуск продолжает с того места, где остановились.
 */
import { mkdir, readFile, writeFile, appendFile, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THUMB_STEPS = [250, 330, 500, 960, 1280, 1920, 3840]; // ширины, которые Wikimedia отдаёт без ограничений
const MAX_BYTES = 15 * 1024 * 1024;
const COLUMNS = [
  'file',
  'category',
  'title',
  'author',
  'license',
  'license_url',
  'source_url',
  'orig_width',
  'orig_height',
  'ratio',
  'bytes',
  'alpha_fraction',
  'sha256',
];

// ratio = [min, max): ширина / высота оригинала. kind: bitmap | drawing (SVG, на выходе PNG).
export const PLAN = [
  {
    id: 'landscape',
    count: 70,
    ratio: [0.8, 1.8],
    minSide: 1200,
    kind: 'bitmap',
    queries: [
      'mountain lake landscape',
      'autumn forest landscape',
      'desert dunes landscape',
      'coast sea cliffs sunset',
      'river valley landscape',
      'snow alpine mountains',
      'meadow wildflowers field',
      'glacier iceland landscape',
      'tropical beach palm',
      'canyon rock formation',
    ],
  },
  {
    id: 'landscape-v',
    count: 15,
    ratio: [0, 0.8],
    minSide: 1200,
    kind: 'bitmap',
    queries: [
      'waterfall',
      'tall tree forest',
      'lighthouse coast',
      'mountain peak',
      'redwood trees',
      'cliff sea',
      'slot canyon',
      'palm tree',
    ],
  },
  {
    id: 'landscape-w',
    count: 15,
    ratio: [1.8, 4],
    minSide: 1200,
    kind: 'bitmap',
    queries: [
      'wide landscape view',
      'valley wide panorama view',
      'coastline wide view',
      'lake mountains reflection',
    ],
  },
  {
    id: 'portrait',
    count: 55,
    ratio: [0.8, 1.8],
    minSide: 1200,
    kind: 'bitmap',
    authorCap: 3,
    queries: [
      'portrait of a woman',
      'portrait of a man',
      'elderly person portrait',
      'student portrait',
      'group of people',
      'street portrait',
      'athlete portrait',
      'musician on stage',
      'scientist portrait',
      'smiling face close up',
    ],
  },
  {
    id: 'portrait-v',
    count: 20,
    ratio: [0, 0.8],
    minSide: 1200,
    kind: 'bitmap',
    authorCap: 3,
    queries: [
      'portrait of a woman',
      'portrait of a man',
      'full-length portrait',
      'speaker at conference',
      'actor portrait',
    ],
  },
  {
    id: 'city',
    count: 40,
    ratio: [0.8, 1.8],
    minSide: 1200,
    kind: 'bitmap',
    queries: [
      'city skyline',
      'old town street',
      'skyscrapers downtown',
      'bridge architecture',
      'cathedral facade',
      'subway station',
      'market street',
      'modern building architecture',
      'harbor city view',
      'road intersection traffic',
    ],
  },
  {
    id: 'city-w',
    count: 10,
    ratio: [1.8, 4],
    minSide: 1200,
    kind: 'bitmap',
    queries: ['city skyline wide', 'bridge wide view', 'harbour wide view'],
  },
  {
    id: 'product',
    count: 50,
    ratio: [0.6, 2],
    minSide: 1000,
    kind: 'bitmap',
    queries: [
      'product photo white background',
      'object on white background',
      'shoes white background',
      'watch isolated',
      'bottle white background',
      'camera product photograph',
      'fruit on white background',
      'furniture isolated',
      'tool white background',
      'electronics isolated',
    ],
  },
  {
    id: 'screenshot',
    count: 50,
    ratio: [0.4, 3],
    minSide: 700,
    kind: 'bitmap',
    authorCap: 4,
    queries: [
      'screenshot website',
      'screenshot desktop software',
      'screenshot mobile app',
      'screenshot web browser',
      'screenshot Linux desktop',
      'screenshot user interface',
      'screenshot dashboard',
      'screenshot code editor',
      'screenshot video game',
      'screenshot Wikipedia article',
    ],
  },
  {
    id: 'graphic',
    count: 50,
    ratio: [0.4, 3],
    minSide: 0,
    kind: 'drawing',
    authorCap: 3,
    queries: [
      'flat illustration',
      'icon set',
      'vector illustration',
      'infographic',
      'logo',
      'cartoon illustration',
      'abstract pattern',
      'colorful diagram',
      'poster illustration',
      'emblem',
    ],
  },
  {
    id: 'alpha',
    count: 55,
    ratio: [0.2, 5],
    minSide: 500,
    kind: ['bitmap', 'drawing'],
    requireAlpha: true,
    authorCap: 3,
    queries: [
      'transparent background',
      'cutout transparent',
      'isolated transparent',
      'png transparent object',
      'sticker transparent',
      'icon transparent background',
      'logo transparent',
      'svg icon',
    ],
  },
  {
    id: 'food',
    count: 25,
    ratio: [0.6, 2],
    minSide: 1000,
    kind: 'bitmap',
    queries: [
      'food dish plated',
      'pizza',
      'fruit market',
      'bread bakery',
      'sushi',
      'dessert cake',
      'vegetables salad',
      'street food',
      'coffee cup',
      'breakfast table',
    ],
  },
  {
    id: 'document',
    count: 25,
    ratio: [0.4, 2],
    minSide: 1000,
    kind: 'bitmap',
    queries: [
      'scanned document page',
      'old book page',
      'handwritten letter',
      'newspaper page',
      'poster typography',
      'street sign text',
      'manuscript page',
      'printed text page',
      'menu board',
      'text map',
    ],
  },
  {
    id: 'night',
    count: 25,
    ratio: [0.6, 2],
    minSide: 1200,
    kind: 'bitmap',
    queries: [
      'night city lights',
      'starry sky night',
      'aurora borealis',
      'night street long exposure',
      'moon night landscape',
      'illuminated building night',
      'fireworks',
      'milky way',
      'neon lights night',
      'night harbour',
    ],
  },
  {
    id: 'panorama',
    count: 8,
    ratio: [4, 12],
    minSide: 1200,
    kind: 'bitmap',
    queries: [
      'panorama',
      'wide panorama mountains',
      'panoramic city',
      'panoramic landscape',
      'panoramic view',
      'panoramic interior',
    ],
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- лицензии ----------
export function licenseOk(lic, copyrighted, allowSA = true) {
  const s = String(lic || '').trim();
  if (/\bNC\b|-NC|-ND|\bND\b|GFDL|fair use|non-?free|all rights/i.test(s)) return false;
  if (/^CC0/i.test(s) || /public domain|^PD\b|^PD-/i.test(s) || copyrighted === 'False')
    return true;
  if (/^CC[ -]BY(-SA)?[ -]?\d/i.test(s)) return allowSA || !/-SA/i.test(s);
  return false;
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// Возвращает причину отказа или null, если кандидат подходит.
export function eligible(cat, info, allowSA = true) {
  const isSvg = info.mime === 'image/svg+xml';
  if (!isSvg && !['image/jpeg', 'image/png', 'image/webp'].includes(info.mime)) return 'mime';
  if (cat.requireAlpha && !(isSvg || info.mime === 'image/png')) return 'mime';
  const w = info.width,
    h = info.height;
  if (!w || !h) return 'size';
  if (!isSvg && Math.max(w, h) < cat.minSide) return 'small';
  const r = w / h;
  if (r < cat.ratio[0] || r >= cat.ratio[1]) return 'ratio';
  const md = info.extmetadata || {};
  if (!licenseOk(md.LicenseShortName?.value, md.Copyrighted?.value, allowSA)) return 'license';
  return null;
}

// ---------- PNG: есть ли реальная прозрачность ----------
export function analyzePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8,
    ihdr = null,
    hasTrns = false;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off),
      type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR')
      ihdr = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8],
        ctype: data[9],
        interlace: data[12],
      };
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'tRNS') hasTrns = true;
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) return null;
  const { w, h, depth, ctype, interlace } = ihdr;
  const alphaChannel = ctype === 4 || ctype === 6;
  if (!alphaChannel)
    return { width: w, height: h, alphaChannel: false, alphaFraction: hasTrns ? null : 0 };
  if (interlace || (depth !== 8 && depth !== 16))
    return { width: w, height: h, alphaChannel, alphaFraction: null };
  const channels = ctype === 6 ? 4 : 2,
    bps = depth / 8,
    bpp = channels * bps,
    stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  let prev = Buffer.alloc(stride),
    pos = 0,
    transparent = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0,
        b = prev[i],
        c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (ft === 1) add = a;
      else if (ft === 2) add = b;
      else if (ft === 3) add = (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) if (line[x * bpp + (channels - 1) * bps] < 255) transparent++;
    prev = line;
  }
  return { width: w, height: h, alphaChannel, alphaFraction: transparent / (w * h) };
}

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (
    buf.length > 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp';
  return null;
}

// ---------- CSV ----------
const csvEsc = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function parseCsv(text) {
  const rows = [];
  let row = [],
    f = '',
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(f);
      f = '';
    } else if (c === '\n') {
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows;
}

// ---------- сеть ----------
async function http(url, ua, accept, tries = 5) {
  for (let a = 1; ; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: accept } });
      if (res.status === 429 || res.status >= 500) {
        if (a >= tries) throw new Error(`HTTP ${res.status}`);
        const ra = Number(res.headers.get('retry-after'));
        await sleep(ra > 0 ? ra * 1000 : 1000 * 2 ** a);
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return res;
    } catch (e) {
      if (e.fatal || a >= tries) throw e;
      await sleep(1000 * 2 ** a);
    }
  }
}

async function* search(o, query, kind) {
  let cont = {};
  for (let page = 0; page < o.maxPages; page++) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'search',
      gsrsearch: `${query} filetype:${kind}`,
      gsrnamespace: '6',
      gsrlimit: '50',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: String(o.width),
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Copyrighted',
      ...cont,
    });
    const data = await (await http(`${o.api}?${params}`, o.ua, 'application/json')).json();
    const pages = (data.query?.pages || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const p of pages) if (p.imageinfo?.[0]) yield { title: p.title, info: p.imageinfo[0] };
    if (!data.continue) return;
    cont = data.continue;
    await sleep(o.delay);
  }
}

// ---------- состояние (manifest.csv) ----------
async function loadState(manifestPath, outDir) {
  const st = {
    titles: new Set(),
    hashes: new Set(),
    rejected: new Set(),
    count: {},
    maxIdx: {},
    authors: {},
    rows: [],
  };
  let text = '';
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch {
    /* первый запуск */
  }
  const rows = parseCsv(text);
  const header = rows.shift() || [];
  for (const r of rows) {
    const row = Object.fromEntries(header.map((h, i) => [h, r[i]]));
    if (!row.file) continue;
    try {
      await access(path.join(outDir, row.file));
    } catch {
      continue;
    }
    st.rows.push(row);
    st.titles.add(row.title);
    st.hashes.add(row.sha256);
    st.count[row.category] = (st.count[row.category] || 0) + 1;
    const n = Number(row.file.match(/-(\d+)\.\w+$/)?.[1] || 0);
    st.maxIdx[row.category] = Math.max(st.maxIdx[row.category] || 0, n);
    const k = `${row.category}|${row.author}`;
    st.authors[k] = (st.authors[k] || 0) + 1;
  }
  return st;
}

function parseArgs(argv) {
  const o = {
    out: path.resolve(HERE, '..', 'test-images'),
    api: 'https://commons.wikimedia.org/w/api.php',
    width: 1280,
    limit: 0,
    delay: 300,
    sa: true,
    dry: false,
    only: [],
    contact: process.env.HAZEHASH_CONTACT || '',
    maxPages: 6,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i],
      next = () => argv[++i];
    if (a === '--out') o.out = path.resolve(next());
    else if (a === '--api') o.api = next();
    else if (a === '--width') o.width = Number(next());
    else if (a === '--limit') o.limit = Number(next());
    else if (a === '--delay') o.delay = Number(next());
    else if (a === '--contact') o.contact = next();
    else if (a === '--category') o.only.push(next());
    else if (a === '--no-sa') o.sa = false;
    else if (a === '--dry-run') o.dry = true;
    else if (a === '--help' || a === '-h') {
      console.log(HELP);
      process.exit(0);
    } else {
      console.error(`Неизвестный параметр: ${a}\n\n${HELP}`);
      process.exit(2);
    }
  }
  o.ua = `hazehash-test-images/1.0 (local benchmark script${o.contact ? '; ' + o.contact : ''})`;
  return o;
}
const HELP = `Использование: node scripts/fetch-test-images.mjs [--dry-run] [--limit N] [--category id] [--out dir]
  [--width 1280] [--delay 300] [--no-sa] [--contact "почта или сайт"] [--api url]
Категории: ${PLAN.map((c) => c.id).join(', ')}`;

// ---------- основной цикл ----------
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!THUMB_STEPS.includes(o.width))
    console.warn(
      `Внимание: ширина ${o.width} не из стандартного списка (${THUMB_STEPS.join(', ')}); Wikimedia может отвечать 429.`,
    );
  if (!o.contact)
    console.warn(
      'Совет: укажите --contact "вы@пример.ру" (политика User-Agent Wikimedia) или переменную HAZEHASH_CONTACT.',
    );
  const plan = PLAN.filter(
    (c) => !o.only.length || o.only.some((x) => c.id === x || c.id.startsWith(x + '-')),
  );
  if (!plan.length) {
    console.error('Нет такой категории.\n' + HELP);
    process.exit(2);
  }

  await mkdir(o.out, { recursive: true });
  console.log(`Папка вывода: ${o.out}`);
  const manifestPath = path.join(o.out, 'manifest.csv');
  if (!o.dry) {
    try {
      await access(path.join(o.out, '.gitignore'));
    } catch {
      await writeFile(path.join(o.out, '.gitignore'), '*\n!.gitignore\n');
    }
    try {
      await access(manifestPath);
    } catch {
      await writeFile(manifestPath, COLUMNS.join(',') + '\n');
    }
  }
  const st = await loadState(manifestPath, o.out);
  let downloaded = 0,
    failed = 0;

  for (const cat of plan) {
    const target = o.limit ? Math.min(cat.count, o.limit) : cat.count;
    let have = st.count[cat.id] || 0,
      dryFound = 0;
    console.log(`\n[${cat.id}] цель ${target}, уже есть ${have}`);
    for (let pass = 1; pass <= 2 && have + dryFound < target; pass++) {
      const perQuery =
        pass === 1 ? Math.max(3, Math.ceil((target / cat.queries.length) * 1.6)) : Infinity;
      const authorCap = (cat.authorCap || 2) + (pass === 2 ? 2 : 0);
      for (const q of cat.queries) {
        if (have + dryFound >= target) break;
        let fromQuery = 0;
        for (const kind of [].concat(cat.kind)) {
          if (have + dryFound >= target || fromQuery >= perQuery) break;
          try {
            for await (const { title, info } of search(o, q, kind)) {
              if (have + dryFound >= target || fromQuery >= perQuery) break;
              if (st.titles.has(title) || st.rejected.has(title)) continue;
              if (eligible(cat, info, o.sa)) continue;
              const md = info.extmetadata || {};
              const author = stripHtml(md.Artist?.value) || 'unknown';
              if ((st.authors[`${cat.id}|${author}`] || 0) >= authorCap) continue;
              if (o.dry) {
                st.titles.add(title);
                st.authors[`${cat.id}|${author}`] = (st.authors[`${cat.id}|${author}`] || 0) + 1;
                dryFound++;
                fromQuery++;
                continue;
              }
              try {
                const res = await http(info.thumburl || info.url, o.ua, 'image/*');
                if (Number(res.headers.get('content-length') || 0) > MAX_BYTES)
                  throw new Error('слишком большой файл');
                const buf = Buffer.from(await res.arrayBuffer());
                const ext = sniff(buf);
                if (!ext || buf.length > MAX_BYTES) throw new Error('не изображение');
                const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
                if (st.hashes.has(sha256)) throw new Error('дубликат');
                let alphaFraction = null;
                if (ext === 'png') {
                  try {
                    alphaFraction = analyzePng(buf)?.alphaFraction ?? null;
                  } catch {
                    alphaFraction = null;
                  }
                }
                if (cat.requireAlpha && !(alphaFraction >= 0.03 && alphaFraction <= 0.97))
                  throw new Error('нет настоящей прозрачности');
                const idx = (st.maxIdx[cat.id] || 0) + 1;
                const file = `${cat.id}-${String(idx).padStart(3, '0')}.${ext}`;
                await writeFile(path.join(o.out, file), buf);
                const row = {
                  file,
                  category: cat.id,
                  title,
                  author,
                  license: md.LicenseShortName?.value || '',
                  license_url: md.LicenseUrl?.value || '',
                  source_url: info.descriptionurl || '',
                  orig_width: info.width,
                  orig_height: info.height,
                  ratio: (info.width / info.height).toFixed(3),
                  bytes: buf.length,
                  alpha_fraction: alphaFraction == null ? '' : alphaFraction.toFixed(3),
                  sha256,
                };
                await appendFile(manifestPath, COLUMNS.map((c) => csvEsc(row[c])).join(',') + '\n');
                st.rows.push(row);
                st.titles.add(title);
                st.hashes.add(sha256);
                st.maxIdx[cat.id] = idx;
                st.count[cat.id] = ++have;
                st.authors[`${cat.id}|${author}`] = (st.authors[`${cat.id}|${author}`] || 0) + 1;
                fromQuery++;
                downloaded++;
                console.log(`  + ${file}  ${info.width}x${info.height}  ${row.license}  ${author}`);
              } catch (e) {
                st.rejected.add(title);
                failed++;
                console.log(`  - ${title}: ${e.message}`);
              }
              await sleep(o.delay);
            }
          } catch (e) {
            console.log(`  ! запрос «${q}» (${kind}): ${e.message}`);
          }
        }
      }
    }
    if (o.dry)
      console.log(`  кандидатов найдено: ${dryFound}${dryFound < target ? ' (меньше цели)' : ''}`);
    else if (have < target) console.log(`  недобор: ${have} из ${target}`);
  }
  if (o.dry) return;

  const rows = st.rows;
  const ratio = (r) => Number(r.ratio);
  const mb = rows.reduce((s, r) => s + Number(r.bytes), 0) / 1048576;
  console.log(
    `\nГотово: скачано ${downloaded}, отклонено ${failed}. Всего в наборе ${rows.length} файлов, ${mb.toFixed(0)} МБ.`,
  );
  console.log(
    `  вертикальных (r < 0.8): ${rows.filter((r) => ratio(r) < 0.8).length}, широких (r > 1.8): ${rows.filter((r) => ratio(r) > 1.8).length}, панорам (r > 4): ${rows.filter((r) => ratio(r) > 4).length}`,
  );
  console.log(`  с прозрачностью: ${rows.filter((r) => Number(r.alpha_fraction) >= 0.03).length}`);
  console.log(
    `  по категориям: ${PLAN.map((c) => `${c.id} ${st.count[c.id] || 0}/${c.count}`).join(', ')}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
