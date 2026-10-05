import { describe, expect, it } from 'vitest';
import { toBytes } from '../src/base64';
import { toBase64Url } from '../src/encoder/base64';
import { BitReader, readRice } from '../src/bits';
import { BitWriter, writeRice } from '../src/encoder/bits';
import { PlaceholderError } from '../src/errors';
import { codeToAspect, outputSize, readHeader } from '../src/format';
import { aspectToCode, writeHeader } from '../src/encoder/header';
import type { Header } from '../src/format';
import { decode, getAspectRatio, getAverageColor } from '../src/decode';
import { dcQuantize } from '../src/encoder/quant';

describe('rice coding', () => {
  it('encodes the worked example (k = 1)', () => {
    const w = new BitWriter();
    for (const q of [3, -1, 0, 2]) writeRice(w, q, 1);
    expect(w.bitLength).toBe(13);
    const bytes = w.finish();
    let bits = '';
    for (const b of bytes) bits += b.toString(2).padStart(8, '0');
    expect(bits.slice(0, 13)).toBe('1110001001100');
  });

  it('round-trips random values for every k', () => {
    for (let k = 0; k < 4; k++) {
      const values = Array.from({ length: 200 }, (_, i) => ((i * 7919) % 31) - 15);
      const w = new BitWriter();
      for (const q of values) writeRice(w, q, k);
      const r = new BitReader(w.finish());
      for (const q of values) expect(readRice(r, k)).toBe(q);
    }
  });
});

describe('base64url', () => {
  it('round-trips all lengths', () => {
    for (let len = 0; len < 60; len++) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
      expect(toBytes(toBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('rejects length 1 mod 4 and bad characters', () => {
    expect(() => toBytes('AAAAA')).toThrowError(PlaceholderError);
    try {
      toBytes('AAAAA');
    } catch (e) {
      expect((e as PlaceholderError).code).toBe('InvalidLength');
    }
    try {
      toBytes('AA+/');
    } catch (e) {
      expect((e as PlaceholderError).code).toBe('InvalidCharacter');
    }
    try {
      toBytes('AAA=');
    } catch (e) {
      expect((e as PlaceholderError).code).toBe('InvalidCharacter');
    }
  });
});

describe('aspect ratio', () => {
  it('maps 1:1 to code 32 and clamps extremes', () => {
    expect(aspectToCode(1)).toBe(32);
    expect(aspectToCode(1 / 100)).toBe(0);
    expect(aspectToCode(100)).toBe(63);
    expect(codeToAspect(32)).toBe(1);
  });

  it('keeps the error within 4.4% inside the range', () => {
    for (let r = 1 / 12; r < 12; r *= 1.013) {
      const back = codeToAspect(aspectToCode(r));
      expect(Math.abs(back / r - 1)).toBeLessThan(0.045);
    }
  });

  it('computes output sizes', () => {
    expect(outputSize(1, 32)).toEqual([32, 32]);
    expect(outputSize(2, 32)).toEqual([32, 16]);
    expect(outputSize(0.5, 32)).toEqual([16, 32]);
    expect(outputSize(1000, 32)).toEqual([32, 1]);
  });
});

describe('header', () => {
  const base: Header = {
    aspectCode: 41,
    alpha: true,
    Lx: 7,
    Ly: 3,
    Cx: 4,
    Cy: 2,
    Ax: 3,
    Ay: 4,
    dc: [63, 0, 33, 31],
    scale: [15, 3, 9, 1],
    k: [3, 0, 2, 1],
  };

  it('round-trips with and without alpha', () => {
    const w = new BitWriter();
    writeHeader(w, base);
    const bytes = w.finish();
    expect(bytes.length).toBe(9);
    expect(readHeader(bytes)).toEqual(base);

    const noAlpha: Header = {
      ...base,
      alpha: false,
      Ax: 1,
      Ay: 1,
      dc: [63, 0, 33, 0],
      scale: [15, 3, 9, 0],
      k: [3, 0, 2, 0],
    };
    const w2 = new BitWriter();
    writeHeader(w2, noAlpha);
    const bytes2 = w2.finish();
    expect(bytes2.length).toBe(7);
    expect(readHeader(bytes2)).toEqual(noAlpha);
  });

  it('rejects short input, long input and unknown versions', () => {
    expect(() => readHeader(new Uint8Array(6))).toThrowError(/InvalidLength/);
    expect(() => readHeader(new Uint8Array(1025))).toThrowError(/InvalidLength/);
    const v = new Uint8Array(7);
    v[0] = 0x40;
    expect(() => readHeader(v)).toThrowError(/UnsupportedVersion/);
    const alphaShort = new Uint8Array(8);
    alphaShort[0] = 0x20;
    expect(() => readHeader(alphaShort)).toThrowError(/InvalidLength/);
  });
});

describe('reference vector 1: flat gray square', () => {
  const bytes = Uint8Array.from([0x10, 0x00, 0x10, 0x3e, 0xf8, 0x00, 0x00]);

  it('has the documented string form', () => {
    expect(toBase64Url(bytes)).toBe('EAAQPvgAAA');
  });

  it('decodes to a uniform neutral gray', () => {
    const img = decode('EAAQPvgAAA');
    expect(img.width).toBe(32);
    expect(img.height).toBe(32);
    const first = Array.from(img.data.slice(0, 4));
    for (let i = 0; i < img.data.length; i += 4) {
      for (let c = 0; c < 3; c++)
        expect(Math.abs(img.data[i + c] - first[c])).toBeLessThanOrEqual(1);
      expect(img.data[i + 3]).toBe(255);
    }
    expect(Math.abs(first[0] - first[1])).toBeLessThanOrEqual(8);
    expect(Math.abs(first[1] - first[2])).toBeLessThanOrEqual(8);
    expect(first[0]).toBeGreaterThan(90);
    expect(first[0]).toBeLessThan(140);
  });

  it('answers header-only queries', () => {
    expect(getAspectRatio(bytes)).toBe(1);
    const c = getAverageColor(bytes);
    expect(c.a).toBe(1);
    expect(Math.abs(c.r - c.g)).toBeLessThanOrEqual(8);
  });

  it('matches the quantizer for the documented values', () => {
    expect(dcQuantize(0, 32 / 63)).toBe(32);
    expect(dcQuantize(1, -0.005)).toBe(31);
  });
});
