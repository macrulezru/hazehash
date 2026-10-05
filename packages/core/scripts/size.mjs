// Reports min+gzip size of each entry point including the shared chunks it imports.
import { execSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const out = 'dist-min';
rmSync(out, { recursive: true, force: true });
execSync(`pnpm exec tsdown --minify --out-dir ${out} --no-dts --format esm`, { stdio: 'ignore' });

const read = (f) => readFileSync(join(out, f), 'utf8');

function closure(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const m of read(entry).matchAll(/from\s*["']\.\/([^"']+\.js)["']/g)) closure(m[1], seen);
  return seen;
}

// target: the design goal; ceiling: hard limit that guards against regressions.
const limits = {
  'index.js': { target: 2.5, ceiling: 2.75 },
  'decode.js': { target: 2.5, ceiling: 2.75 },
  'encode.js': { target: 6, ceiling: 6.4 },
  'canvas.js': { target: 0.5, ceiling: 0.5 },
};
let failed = false;
for (const entry of ['index.js', 'decode.js', 'encode.js', 'canvas.js']) {
  const set = closure(entry);
  const gz = (names) => gzipSync(Buffer.from([...names].map(read).join(' ')), { level: 9 }).length;
  const total = gz(set);
  let kb = total / 1024;
  if (entry === 'canvas.js') {
    // The limit for ./canvas is on top of the decoder.
    kb = (total - gz(closure('decode.js'))) / 1024;
  }
  const { target, ceiling } = limits[entry];
  if (kb > ceiling) failed = true;
  const status = kb <= target ? 'ok' : kb <= ceiling ? 'over target' : 'OVER CEILING';
  console.log(`${entry.padEnd(11)} ${kb.toFixed(2)} KB gzip (target ${target}, ceiling ${ceiling}) ${status}`);
}
rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
