// Cross-engine check: the built bundle must reproduce the frozen vectors within ±1 in Chromium,
// Firefox and WebKit, encode valid hashes, and draw into a real canvas.
// Requires `pnpm build` and `pnpm --filter hazehash-e2e install-browsers`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dist = join(root, 'packages/core/dist');
const vectors = JSON.parse(
  await readFile(join(root, 'packages/core/test/vectors/v1.json'), 'utf8'),
);

const types = { '.js': 'text/javascript', '.html': 'text/html' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>e2e</title>');
      return;
    }
    const file = join(dist, url.pathname.replace(/^\/dist\//, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let failures = 0;
for (const [name, launcher] of Object.entries({ chromium, firefox, webkit })) {
  let browser;
  try {
    browser = await launcher.launch();
  } catch (e) {
    console.log(`${name}: SKIPPED (${String(e.message).split('\n')[0]})`);
    continue;
  }
  const page = await browser.newPage();
  await page.goto(base);
  const result = await page.evaluate(
    async ({ vectors, base }) => {
      const dec = await import(`${base}/dist/decode.js`);
      const enc = await import(`${base}/dist/encode.js`);
      const cv = await import(`${base}/dist/canvas.js`);
      let worst = 0;
      for (const v of vectors.vectors) {
        const bin = atob(v.rgba);
        const img = dec.decode(v.hash, { size: v.size });
        for (let i = 0; i < bin.length; i++) {
          worst = Math.max(worst, Math.abs(img.data[i] - bin.charCodeAt(i)));
        }
      }
      // Integer-only test image: no engine-dependent math in the input itself.
      const w = 80;
      const h = 60;
      const data = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          data[o] = (x * 255) / w;
          data[o + 1] = (y * 255) / h;
          data[o + 2] = ((x >> 3) + (y >> 3)) % 2 ? 200 : 60;
          data[o + 3] = 255;
        }
      }
      const bytes = enc.encode({ data, width: w, height: h });
      const hash = enc.encodeToString({ data, width: w, height: h });
      const canvas = document.createElement('canvas');
      cv.drawToCanvas(hash, canvas);
      const drawn = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const direct = dec.decode(hash);
      let canvasDiff = 0;
      for (let i = 0; i < direct.data.length; i++) {
        canvasDiff = Math.max(canvasDiff, Math.abs(drawn[i] - direct.data[i]));
      }
      return { worst, length: bytes.length, hash, canvasDiff, size: [canvas.width, canvas.height] };
    },
    { vectors, base },
  );
  const ok = result.worst <= 1 && result.length <= 28 && result.canvasDiff <= 1;
  if (!ok) failures++;
  console.log(
    `${name}: ${ok ? 'OK' : 'FAIL'} vectors max diff ${result.worst}, encoded ${result.length} bytes (${result.hash}), canvas diff ${result.canvasDiff}`,
  );
  await browser.close();
}
server.close();
process.exit(failures === 0 ? 0 : 1);
