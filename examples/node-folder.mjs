// Encodes every image in a folder and writes hashes.json next to this script.
//   pnpm --filter hazehash-examples hashes -- ../test-images 24
import { readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFileToString } from 'hazehash/node';

// pnpm forwards a literal "--"; relative paths are resolved from where the command was started.
const args = process.argv.slice(2).filter((a) => a !== '--');
const dir = resolve(process.env.INIT_CWD ?? '.', args[0] ?? '.');
const budget = Number(args[1] ?? 28);
const images = (await readdir(dir)).filter((f) =>
  ['.jpg', '.jpeg', '.png', '.webp'].includes(extname(f).toLowerCase()),
);

const hashes = {};
for (const name of images.slice(0, 200)) {
  hashes[name] = await encodeFileToString(join(dir, name), { budget });
}
const out = fileURLToPath(new URL('./hashes.json', import.meta.url));
await writeFile(out, JSON.stringify(hashes, null, 2));
console.log(`${Object.keys(hashes).length} hashes written to ${out}`);
