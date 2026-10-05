// Tiny static server for browser.html: serves the repository root on http://localhost:5173.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(root)) throw new Error('outside root');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(5173, () => console.log('http://localhost:5173/examples/browser.html'));
