// Smoke test of the demo app: build it first (`pnpm --filter hazehash-demo build`).
// Starts the built server, opens the page in Chromium and checks the table. Set SHOT=path.png to
// save a full-page screenshot.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const demo = resolve(fileURLToPath(new URL('../demo', import.meta.url)));
const port = 3998;
const server = spawn('node', ['.output/server/index.mjs'], {
  cwd: demo,
  env: { ...process.env, PORT: String(port), NITRO_PORT: String(port) },
  stdio: 'ignore',
});

let failed = false;
try {
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(url);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const warnings = [];
  page.on('console', (m) => ['warning', 'error'].includes(m.type()) && warnings.push(m.text()));
  await page.goto(url, { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    return rows.map((tr) => {
      const canvas = tr.querySelector('canvas');
      let painted = false;
      if (canvas) {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        painted = data.some((v, i) => i % 4 === 3 && v > 0);
      }
      return {
        hash: tr.querySelector('.hash code')?.textContent ?? '',
        painted,
        size: canvas ? [canvas.width, canvas.height] : null,
      };
    });
  });

  const ok = result.length >= 10 && result.every((r) => r.hash.length >= 10 && r.painted);
  console.log(`demo: ${result.length} rows, all hashes present and canvases painted: ${ok}`);
  if (warnings.length) console.log('console warnings:', warnings);
  if (!ok || warnings.length) failed = true;
  if (process.env.SHOT) await page.screenshot({ path: resolve(process.env.SHOT), fullPage: true });
  await browser.close();
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
