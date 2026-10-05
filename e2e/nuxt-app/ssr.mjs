// Builds the Nuxt app, starts the server and checks the server-rendered placeholder.
import { spawn, execSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = resolve(fileURLToPath(new URL('.', import.meta.url)));
await mkdir(join(dir, 'public/images'), { recursive: true });

// A small colourful test image, generated so that nothing binary is committed.
const w = 96;
const h = 64;
const raw = Buffer.alloc(w * h * 3);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3;
    raw[o] = (x * 255) / w;
    raw[o + 1] = (y * 255) / h;
    raw[o + 2] = (x + y) % 2 ? 180 : 90;
  }
}
await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
  .png()
  .toFile(join(dir, 'public/images/sample.png'));

execSync('pnpm exec nuxt build', { cwd: dir, stdio: 'inherit' });

const manifest = await readFile(join(dir, '.nuxt/hazehash-manifest.mjs'), 'utf8');
const hash = /"\/images\/sample\.png": "([^"]+)"/.exec(manifest)?.[1];
if (!hash) throw new Error(`manifest has no hash for sample.png:\n${manifest}`);

const port = 3999;
const server = spawn('node', ['.output/server/index.mjs'], {
  cwd: dir,
  env: { ...process.env, PORT: String(port), NITRO_PORT: String(port) },
  stdio: 'inherit',
});
try {
  let html = '';
  for (let i = 0; i < 50; i++) {
    try {
      html = await (await fetch(`http://localhost:${port}/`)).text();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const checks = {
    'background-color': html.includes('background-color'),
    'aspect-ratio 96 / 64': html.includes('aspect-ratio:96 / 64'),
    'img tag': html.includes('<img'),
    'no canvas on the server': !html.includes('<canvas'),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  console.log(`hash ${hash} (${hash.length} chars)`, checks);
  if (failed.length) {
    console.error(html);
    process.exitCode = 1;
  } else {
    console.log('nuxt SSR: OK');
  }
} finally {
  server.kill();
}
