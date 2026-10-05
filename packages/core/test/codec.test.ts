import { describe, expect, it } from 'vitest';
import { decode, getAspectRatio, getAverageColor } from '../src/decode';
import { encode, encodeToString } from '../src/encode';
import { PlaceholderError } from '../src/errors';
import { noise, rng, scene, solid } from './helpers';

describe('encode input validation', () => {
  it('rejects malformed images', () => {
    expect(() => encode({ data: new Uint8Array(3), width: 1, height: 1 })).toThrowError(
      /InvalidInput/,
    );
    expect(() => encode({ data: new Uint8Array(0), width: 0, height: 0 })).toThrowError(
      /InvalidInput/,
    );
    expect(() => encode({ data: new Uint8Array(4), width: 1.5, height: 1 })).toThrowError(
      /InvalidInput/,
    );
  });

  it('reports a too-small budget', () => {
    const img = solid(4, 4, [10, 20, 30, 255]);
    try {
      encode(img, { budget: 6 });
      throw new Error('expected failure');
    } catch (e) {
      expect((e as PlaceholderError).code).toBe('BudgetTooSmall');
    }
    expect(() => encode(solid(4, 4, [0, 0, 0, 0]), { budget: 8 })).toThrowError(/BudgetTooSmall/);
  });
});

describe('special cases', () => {
  it('encodes a flat image into the header alone', () => {
    const bytes = encode(solid(40, 30, [200, 100, 50, 255]));
    expect(bytes.length).toBe(7);
    const px = decode(bytes, { dither: false }).data;
    expect(Math.abs(px[0] - 200)).toBeLessThanOrEqual(10);
    expect(Math.abs(px[1] - 100)).toBeLessThanOrEqual(10);
    expect(Math.abs(px[2] - 50)).toBeLessThanOrEqual(10);
  });

  it('keeps pure white white', () => {
    const px = decode(encode(solid(20, 20, [255, 255, 255, 255])), { dither: false }).data;
    expect(Array.from(px.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it('keeps pure black black', () => {
    const px = decode(encode(solid(20, 20, [0, 0, 0, 255])), { dither: false }).data;
    expect(Array.from(px.slice(0, 4))).toEqual([0, 0, 0, 255]);
  });

  it('encodes a fully transparent image with alpha DC 0', () => {
    const bytes = encode(solid(16, 16, [255, 0, 0, 0]));
    const img = decode(bytes);
    expect(bytes.length).toBe(9);
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(0);
    expect(getAverageColor(bytes).a).toBe(0);
  });

  it('stores half-transparent images with alpha', () => {
    const img = scene(48, 48, 5, true);
    const out = decode(encode(img));
    expect(out.data[3]).toBeGreaterThan(200);
    expect(out.data[(out.width - 1) * 4 + 3]).toBeLessThan(60);
  });

  it('writes alpha only when needed under "auto"', () => {
    expect(encode(scene(32, 32, 1)).length).toBeGreaterThanOrEqual(7);
    expect(encode(solid(8, 8, [1, 2, 3, 255]), { alpha: true }).length).toBe(9);
    expect(encode(solid(8, 8, [1, 2, 3, 0]), { alpha: false }).length).toBe(7);
  });

  it('records the aspect ratio', () => {
    const r = getAspectRatio(encode(scene(160, 40, 2)));
    expect(Math.abs(r / 4 - 1)).toBeLessThan(0.05);
    const out = decode(encode(scene(160, 40, 2)));
    expect(out.width).toBe(32);
    expect(out.height).toBe(8);
  });
});

describe('edge-case sizes', () => {
  const sizes: Array<[number, number]> = [
    [1, 1],
    [2, 2],
    [1, 37],
    [37, 1],
    [3, 5],
    [10, 500],
    [500, 10],
    [7, 7],
    [101, 59],
    [8, 8],
  ];
  for (const [w, h] of sizes) {
    it(`handles ${w}x${h}`, () => {
      const img = scene(w, h, w * 31 + h);
      const bytes = encode(img);
      expect(bytes.length).toBeLessThanOrEqual(28);
      const out = decode(bytes);
      expect(out.data.length).toBe(out.width * out.height * 4);
    });
  }

  it('handles extreme aspect ratios 1:50 and 50:1', () => {
    for (const [w, h] of [
      [20, 1000],
      [1000, 20],
    ]) {
      const bytes = encode(scene(w, h, 9));
      const out = decode(bytes);
      expect(Math.max(out.width, out.height)).toBe(32);
      expect(Math.min(out.width, out.height)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('budget and quality', () => {
  it('never exceeds the budget and gets closer to the source with more bytes', () => {
    const img = scene(128, 128, 3);
    // Reference: 4x4 box average of the source at 32x32.
    const ref = new Float64Array(32 * 32 * 3);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let dy = 0; dy < 4; dy++) {
            for (let dx = 0; dx < 4; dx++) s += img.data[((y * 4 + dy) * 128 + x * 4 + dx) * 4 + c];
          }
          ref[(y * 32 + x) * 3 + c] = s / 16;
        }
      }
    }
    const errorAt = (budget: number): number => {
      const bytes = encode(img, { budget });
      expect(bytes.length).toBeLessThanOrEqual(budget);
      const out = decode(bytes, { dither: false });
      expect([out.width, out.height]).toEqual([32, 32]);
      let sum = 0;
      for (let p = 0; p < 32 * 32; p++) {
        for (let c = 0; c < 3; c++) sum += Math.abs(out.data[p * 4 + c] - ref[p * 3 + c]);
      }
      return sum / (32 * 32 * 3);
    };
    const errors = [8, 12, 16, 20, 28, 36, 48].map(errorAt);
    // Rate-distortion choices may reorder neighbouring budgets slightly; the trend must hold.
    expect(errors[4]).toBeLessThan(errors[0]);
    expect(errors[6]).toBeLessThanOrEqual(errors[2]);
  });

  it('is deterministic', () => {
    const img = scene(97, 61, 11, true);
    expect(encodeToString(img)).toBe(encodeToString(img));
  });

  it('keeps a plausible reconstruction of a smooth scene', () => {
    const img = scene(64, 64, 21);
    const out = decode(encode(img), { dither: false });
    // Compare with a crude 32x32 box-average of the source.
    let err = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) s += img.data[((y * 2 + dy) * 64 + x * 2 + dx) * 4 + c];
          }
          err += Math.abs(s / 4 - out.data[(y * 32 + x) * 4 + c]);
        }
      }
    }
    expect(err / (32 * 32 * 3)).toBeLessThan(25);
  });

  it('accepts truncated hashes', () => {
    const bytes = encode(scene(64, 64, 4));
    for (let len = 7; len <= bytes.length; len++) {
      const out = decode(bytes.subarray(0, len));
      expect(out.width).toBe(32);
    }
  });

  it('survives random images and budgets', () => {
    const rand = rng(123);
    for (let t = 0; t < 40; t++) {
      const w = 1 + Math.floor(rand() * 90);
      const h = 1 + Math.floor(rand() * 90);
      const budget = 9 + Math.floor(rand() * 40);
      const img = t % 3 === 0 ? noise(w, h, t) : scene(w, h, t, t % 3 === 1);
      const bytes = encode(img, { budget });
      expect(bytes.length).toBeLessThanOrEqual(budget);
      expect(() => decode(bytes)).not.toThrow();
    }
  });

  it('supports every profile', () => {
    const img = scene(80, 60, 8);
    for (const profile of ['fast', 'default', 'high'] as const) {
      expect(encode(img, { profile }).length).toBeLessThanOrEqual(28);
    }
  });
});

describe('decoder robustness', () => {
  it('returns a result or PlaceholderError on random input', () => {
    const rand = rng(7);
    for (let t = 0; t < 3000; t++) {
      const len = Math.floor(rand() * 1100);
      const bytes = Uint8Array.from({ length: len }, () => Math.floor(rand() * 256));
      try {
        decode(bytes);
      } catch (e) {
        expect(e).toBeInstanceOf(PlaceholderError);
      }
    }
  });
});
