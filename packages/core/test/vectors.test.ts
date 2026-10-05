import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decode } from '../src/decode';

interface VectorFile {
  format: number;
  tolerance: number;
  vectors: Array<{ name: string; hash: string; size: number; rgba: string }>;
}

const file = JSON.parse(readFileSync(join(__dirname, 'vectors/v1.json'), 'utf8')) as VectorFile;

describe('frozen reference vectors (format version 1)', () => {
  it('has at least 50 vectors', () => {
    expect(file.vectors.length).toBeGreaterThanOrEqual(50);
  });

  for (const v of file.vectors) {
    it(`decodes ${v.name} within ±${file.tolerance}`, () => {
      const expected = Buffer.from(v.rgba, 'base64');
      const img = decode(v.hash, { size: v.size });
      expect(img.data.length).toBe(expected.length);
      let worst = 0;
      for (let i = 0; i < expected.length; i++) {
        worst = Math.max(worst, Math.abs(img.data[i] - expected[i]));
      }
      expect(worst).toBeLessThanOrEqual(file.tolerance);
    });
  }
});
