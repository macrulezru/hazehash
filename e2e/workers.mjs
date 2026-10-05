// Runs the built core inside workerd (the Cloudflare Workers runtime) via Miniflare.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const { vectors } = JSON.parse(
  await readFile(join(root, 'packages/core/test/vectors/v1.json'), 'utf8'),
);

const mf = new Miniflare({
  modules: true,
  modulesRoot: root,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  scriptPath: join(root, 'e2e/worker.mjs'),
  compatibilityDate: '2024-09-01',
});
try {
  const res = await mf.dispatchFetch('http://localhost/', {
    method: 'POST',
    body: JSON.stringify({ vectors }),
  });
  const r = await res.json();
  const ok = r.worst <= 1 && r.length <= 28;
  console.log(
    `workerd: ${ok ? 'OK' : 'FAIL'} vectors max diff ${r.worst}, encoded ${r.length} bytes (${r.hash})`,
  );
  process.exitCode = ok ? 0 : 1;
} finally {
  await mf.dispose();
}
