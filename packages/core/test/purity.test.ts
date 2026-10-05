import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Files allowed to touch the DOM, Node or optional dependencies. */
const PLATFORM_FILES = ['canvas.ts', 'node.ts', 'sharp.ts', 'cli.ts'];

describe('core purity', () => {
  const core = sources(SRC).filter(
    (f) =>
      !PLATFORM_FILES.some((p) => f.endsWith(p)) && !f.replace(/\\/g, '/').includes('/src/cli/'),
  );

  it('finds the core files', () => {
    expect(core.length).toBeGreaterThan(10);
  });

  const forbidden: Array<[string, RegExp]> = [
    [
      'browser globals',
      /\b(window|document|navigator|HTMLCanvasElement|OffscreenCanvas|ImageData)\b/,
    ],
    ['Node globals', /\b(Buffer|process|require|__dirname|__filename)\b/],
    ['eval and Function', /\beval\s*\(|new\s+Function\b/],
    ['dynamic import', /\bimport\s*\(/],
    ['node: imports', /from\s+['"]node:/],
  ];

  for (const [label, pattern] of forbidden) {
    it(`has no ${label}`, () => {
      for (const file of core) {
        // Strip comments so that prose does not trigger the check.
        const code = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        expect(pattern.test(code), `${label} in ${file}`).toBe(false);
      }
    });
  }
});
