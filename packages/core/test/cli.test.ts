import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decode } from '../src/decode';
import { enumOption, intOption, parseArgs, UsageError, type OptionSpec } from '../src/cli/args';
import { formatBytes, truncateMiddle, wrap } from '../src/cli/format';
import { expandInputs, globToRegExp, hasGlob } from '../src/cli/glob';
import type { Io } from '../src/cli/io';
import { nearestRatio } from '../src/cli/commands/info';
import { run } from '../src/cli/main';
import { detectColorDepth, makeStyle, stripAnsi, visibleLength } from '../src/cli/style';

const ESC = String.fromCharCode(27);

describe('parseArgs', () => {
  const specs: OptionSpec[] = [
    { long: 'budget', short: 'b', kind: 'value' },
    { long: 'recursive', short: 'r', kind: 'flag' },
    { long: 'quiet', short: 'q', kind: 'flag' },
    { long: 'color', kind: 'flag', negatable: true },
  ];

  it('reads long, short and inline values', () => {
    expect(parseArgs(['--budget', '24', 'a.jpg'], specs).values.get('budget')).toBe('24');
    expect(parseArgs(['--budget=24'], specs).values.get('budget')).toBe('24');
    expect(parseArgs(['-b', '24'], specs).values.get('budget')).toBe('24');
    expect(parseArgs(['-b24'], specs).values.get('budget')).toBe('24');
  });

  it('groups short flags and keeps positionals in order', () => {
    const parsed = parseArgs(['one', '-rq', 'two'], specs);
    expect([...parsed.flags].sort()).toEqual(['quiet', 'recursive']);
    expect(parsed.positionals).toEqual(['one', 'two']);
  });

  it('understands --no-<flag>, "-" and "--"', () => {
    expect(parseArgs(['--no-color'], specs).flags.has('no-color')).toBe(true);
    expect(parseArgs(['-'], specs).positionals).toEqual(['-']);
    expect(parseArgs(['--', '--budget', '-r'], specs).positionals).toEqual(['--budget', '-r']);
  });

  it('rejects unknown options with a suggestion, and missing values', () => {
    expect(() => parseArgs(['--bugdet', '5'], specs)).toThrowError(UsageError);
    try {
      parseArgs(['--bugdet', '5'], specs);
    } catch (e) {
      expect((e as UsageError).hint).toBe('Did you mean --budget?');
    }
    expect(() => parseArgs(['--budget'], specs)).toThrowError(/needs a value/);
    expect(() => parseArgs(['--quiet=1'], specs)).toThrowError(/does not take a value/);
    expect(() => parseArgs(['-x'], specs)).toThrowError(/Unknown option -x/);
  });

  it('validates numbers and words', () => {
    const parsed = parseArgs(['--budget', '9999'], specs);
    expect(() => intOption(parsed, 'budget', { min: 1, max: 1024 })).toThrowError(/whole number/);
    expect(intOption(parseArgs(['-b', '24'], specs), 'budget', { min: 1, max: 1024 })).toBe(24);
    expect(intOption(parseArgs([], specs), 'budget', { min: 1, max: 1024 })).toBeUndefined();
    expect(() => enumOption(parsed, 'budget', ['a', 'b'] as const)).toThrowError(/one of/);
  });
});

describe('styling', () => {
  it('chooses a colour depth from the environment', () => {
    expect(detectColorDepth({}, false, 'linux')).toBe(0);
    expect(detectColorDepth({}, true, 'linux')).toBe(4);
    expect(detectColorDepth({ TERM: 'xterm-256color' }, true, 'linux')).toBe(8);
    expect(detectColorDepth({ COLORTERM: 'truecolor' }, true, 'linux')).toBe(24);
    expect(detectColorDepth({}, true, 'win32')).toBe(24);
    expect(detectColorDepth({ TERM: 'dumb' }, true, 'linux')).toBe(0);
    expect(detectColorDepth({ NO_COLOR: '1' }, true, 'linux')).toBe(0);
    expect(detectColorDepth({ FORCE_COLOR: '3' }, false, 'linux')).toBe(24);
    expect(detectColorDepth({ FORCE_COLOR: '0', COLORTERM: 'truecolor' }, true, 'linux')).toBe(24);
    expect(detectColorDepth({ COLORTERM: 'truecolor' }, true, 'linux', false)).toBe(0);
    expect(detectColorDepth({}, false, 'linux', true)).toBeGreaterThanOrEqual(4);
    expect(detectColorDepth({ NO_COLOR: '1' }, true, 'linux', true)).toBe(0);
  });

  it('wraps text in escape codes only when colour is on', () => {
    expect(makeStyle(0).red('x')).toBe('x');
    expect(makeStyle(24).red('x')).toBe(`${ESC}[31mx${ESC}[39m`);
    expect(makeStyle(24).bg({ r: 1, g: 2, b: 3 })).toBe(`${ESC}[48;2;1;2;3m`);
    expect(makeStyle(8).bg({ r: 255, g: 0, b: 0 })).toBe(`${ESC}[48;5;196m`);
    expect(makeStyle(4).bg({ r: 255, g: 0, b: 0 })).toBe('');
  });

  it('measures what is visible', () => {
    const s = makeStyle(24);
    expect(stripAnsi(s.bold(s.green('abc')))).toBe('abc');
    expect(visibleLength(s.bold(s.green('abc')))).toBe(3);
    expect(visibleLength('✔ ok')).toBe(4);
  });
});

describe('text helpers', () => {
  it('formats sizes and shortens names', () => {
    expect(formatBytes(461)).toBe('461 B');
    expect(formatBytes(54413)).toBe('53.1 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(truncateMiddle('abcdefghij', 6)).toBe('abc…ij');
    expect(truncateMiddle('abc', 6)).toBe('abc');
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four']);
  });

  it('finds the nearest simple ratio', () => {
    expect(nearestRatio(1)).toBe('1:1');
    expect(nearestRatio(1.5)).toBe('3:2');
    expect(nearestRatio(16 / 9)).toBe('16:9');
    expect(nearestRatio(0.5)).toBe('1:2');
  });
});

describe('globs', () => {
  it('matches * within a folder and ** across folders', () => {
    expect(globToRegExp('a/*.jpg').test('a/x.jpg')).toBe(true);
    expect(globToRegExp('a/*.jpg').test('a/b/x.jpg')).toBe(false);
    expect(globToRegExp('a/**/*.jpg').test('a/b/c/x.jpg')).toBe(true);
    expect(globToRegExp('a/**/*.jpg').test('a/x.jpg')).toBe(true);
    expect(globToRegExp('x?.png').test('xy.png')).toBe(true);
    expect(globToRegExp('x.png').test('xxpng')).toBe(false);
    expect(globToRegExp('A/*.JPG', true).test('a/x.jpg')).toBe(true);
    expect(hasGlob('a/*.jpg')).toBe(true);
    expect(hasGlob('a/b.jpg')).toBe(false);
  });
});

/** A gradient picture; `tint` changes the colours so files differ. */
async function picture(width: number, height: number, tint: number, alpha = false) {
  const channels = alpha ? 4 : 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      data[o] = (x * 255) / width;
      data[o + 1] = (y * 255) / height;
      data[o + 2] = tint;
      if (alpha) data[o + 3] = x < width / 2 ? 255 : 60;
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hazehash-cli-'));
  await mkdir(join(root, 'photos/deep'), { recursive: true });
  await writeFile(join(root, 'photos/a.png'), await picture(80, 60, 40));
  await writeFile(join(root, 'photos/b.png'), await picture(60, 80, 160));
  await writeFile(join(root, 'photos/deep/c.png'), await picture(90, 60, 220, true));
  await writeFile(join(root, 'photos/notes.txt'), 'not an image');
  await writeFile(join(root, 'broken.png'), 'definitely not a png');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Fake {
  io: Io;
  out(): string;
  err(): string;
}

function fake(
  options: {
    tty?: boolean;
    env?: Record<string, string>;
    stdin?: Uint8Array;
    columns?: number;
  } = {},
): Fake {
  let out = '';
  let err = '';
  let clock = 0;
  return {
    io: {
      stdout: {
        write: (t) => void (out += t),
        isTTY: options.tty ?? false,
        columns: options.columns ?? 120,
      },
      stderr: { write: (t) => void (err += t), isTTY: false },
      readStdin: async () => options.stdin ?? new Uint8Array(),
      env: options.env ?? {},
      cwd: root,
      platform: 'linux',
      now: () => (clock += 10),
    },
    out: () => out,
    err: () => err,
  };
}

const exec = async (args: string[], options?: Parameters<typeof fake>[0]) => {
  const f = fake(options);
  const code = await run(args, f.io, '9.9.9');
  return { code, out: f.out(), err: f.err() };
};

describe('help and version', () => {
  it('prints the version', async () => {
    expect(await exec(['--version'])).toMatchObject({ code: 0, out: '9.9.9\n' });
    expect((await exec(['encode', '-V'])).out).toBe('9.9.9\n');
  });

  it('prints help for the tool and for every command', async () => {
    for (const args of [[], ['--help'], ['-h'], ['help']]) {
      const r = await exec(args);
      expect(r.code).toBe(0);
      expect(r.out).toContain('USAGE');
      expect(r.out).toContain('encode <images…>');
      expect(r.out).toContain('EXAMPLES');
    }
    const encode = await exec(['encode', '--help']);
    expect(encode.out).toContain('--budget <bytes>');
    expect(encode.out).toContain('BUDGET GUIDE');
    expect(encode.out).toContain('EXIT CODES');
    expect((await exec(['help', 'decode'])).out).toContain('--scale <n>');
    expect((await exec(['info', '--help'])).out).toContain('--json');
  });

  it('uses colour in help only when asked for or in a terminal', async () => {
    expect((await exec(['--help'])).out).not.toContain(ESC);
    expect((await exec(['--help', '--color'])).out).toContain(ESC);
    expect((await exec(['--help'], { tty: true, env: { COLORTERM: 'truecolor' } })).out).toContain(
      ESC,
    );
    expect((await exec(['--help', '--no-color'], { tty: true })).out).not.toContain(ESC);
    expect((await exec(['--help'], { tty: true, env: { NO_COLOR: '1' } })).out).not.toContain(ESC);
  });
});

describe('usage errors', () => {
  it('exit with code 2 and explain', async () => {
    const cases: Array<[string[], RegExp]> = [
      [['nope'], /Unknown command "nope"/],
      [['encode'], /No input given/],
      [['encode', 'x', '--bugdet', '5'], /Did you mean --budget/],
      [['encode', 'x', '--budget', 'abc'], /whole number/],
      [['encode', 'x', '--profile', 'turbo'], /one of: fast, default, high/],
      [['encode', 'x', '--pretty', '--plain'], /cannot be used together/],
      [['decode'], /No hash given/],
      [['info', 'a', 'b'], /exactly one hash/],
      [['help', 'nope'], /Unknown command/],
    ];
    for (const [args, message] of cases) {
      const r = await exec(args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.err).toMatch(message);
    }
  });
});

describe('encode', () => {
  it('prints just the hash for one image', async () => {
    const r = await exec(['encode', 'photos/a.png']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^[A-Za-z0-9_-]{10,}\n$/);
    expect(() => decode(r.out.trim())).not.toThrow();
    expect(r.err).toBe('');
  });

  it('prints path and hash for several images, in input order', async () => {
    const r = await exec(['encode', 'photos/b.png', 'photos/a.png']);
    expect(r.code).toBe(0);
    const lines = r.out
      .trim()
      .split('\n')
      .map((l) => l.split('\t'));
    expect(lines.map((l) => l[0])).toEqual(['photos/b.png', 'photos/a.png']);
  });

  it('honours the budget', async () => {
    const small = await exec(['encode', 'photos/a.png', '--budget', '12']);
    const large = await exec(['encode', 'photos/a.png', '--budget', '40']);
    expect(small.out.trim().length).toBeLessThan(large.out.trim().length);
    expect(Math.ceil((small.out.trim().length * 6) / 8)).toBeLessThanOrEqual(12);
  });

  it('reports an impossible budget per image', async () => {
    const r = await exec(['encode', 'photos/a.png', '--budget', '3']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/budget 3 is too small/);
  });

  it('expands folders, recursive folders and globs', async () => {
    const folder = await exec(['encode', 'photos']);
    expect(
      folder.out
        .trim()
        .split('\n')
        .map((l) => l.split('\t')[0]),
    ).toEqual(['photos/a.png', 'photos/b.png']);
    const recursive = await exec(['encode', 'photos', '-r']);
    expect(recursive.out).toContain('photos/deep/c.png');
    const glob = await exec(['encode', 'photos/**/*.png']);
    expect(glob.out.trim().split('\n')).toHaveLength(3);
    const shallow = await exec(['encode', 'photos/*.png']);
    expect(shallow.out.trim().split('\n')).toHaveLength(2);
  });

  it('writes json, csv and details', async () => {
    const json = JSON.parse((await exec(['encode', 'photos/*.png', '-f', 'json'])).out);
    expect(Object.keys(json)).toEqual(['photos/a.png', 'photos/b.png']);
    const details = JSON.parse(
      (await exec(['encode', 'photos/a.png', '-f', 'json', '--details'])).out,
    );
    expect(details['photos/a.png']).toMatchObject({ width: 80, height: 60 });
    expect(details['photos/a.png'].bytes).toBeLessThanOrEqual(28);
    const csv = (await exec(['encode', 'photos/*.png', '-f', 'csv', '--details'])).out
      .trim()
      .split('\n');
    expect(csv[0]).toBe('file,hash,bytes,width,height,fileBytes');
    expect(csv).toHaveLength(3);
  });

  it('prints hex on request', async () => {
    const r = await exec(['encode', 'photos/a.png', '--hex']);
    expect(r.out.trim()).toMatch(/^[0-9a-f]+$/);
    const bytes = Uint8Array.from(Buffer.from(r.out.trim(), 'hex'));
    expect(() => decode(bytes)).not.toThrow();
  });

  it('writes to a file with --output', async () => {
    const r = await exec(['encode', 'photos', '-f', 'json', '-o', 'out.json']);
    expect(r.code).toBe(0);
    expect(r.out).toBe('');
    expect(r.err).toContain('wrote 2 hashes to out.json');
    expect(Object.keys(JSON.parse(await readFile(join(root, 'out.json'), 'utf8')))).toHaveLength(2);
  });

  it('reads one image from standard input', async () => {
    const stdin = new Uint8Array(await picture(50, 50, 100));
    const r = await exec(['encode', '-'], { stdin });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^[A-Za-z0-9_-]+\n$/);
    const empty = await exec(['encode', '-']);
    expect(empty.code).toBe(1);
    expect(empty.err).toContain('no data on standard input');
  });

  it('keeps going after a failure and exits with 1', async () => {
    const r = await exec([
      'encode',
      'photos/a.png',
      'broken.png',
      'missing.png',
      'photos/notes.txt',
    ]);
    expect(r.code).toBe(1);
    expect(r.out.trim().split('\n')).toHaveLength(1);
    expect(r.out).toMatch(/^photos\/a\.png\t/);
    expect(r.err).toContain('broken.png');
    expect(r.err).toContain('missing.png: no image found');
    expect(r.err).toContain('notes.txt');
  });

  it('shows a coloured table in a terminal', async () => {
    const r = await exec(['encode', 'photos', '-r'], {
      tty: true,
      env: { COLORTERM: 'truecolor' },
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain(ESC);
    const plain = stripAnsi(r.out);
    expect(plain).toContain('HazeHash encode');
    expect(plain).toContain('photos/deep/c.png');
    expect(plain).toMatch(/✔ 3 hashes/);
    expect(plain).toContain('Smaller is the file size divided by the hash size');
    // The colour swatch is a true-colour background block.
    expect(r.out).toMatch(new RegExp(`${ESC}\\[48;2;\\d+;\\d+;\\d+m  ${ESC}\\[0m`));
  });

  it('has no colour in the table when disabled, and shows failures', async () => {
    const r = await exec(['encode', 'photos/a.png', 'missing.png', '--no-color'], { tty: true });
    expect(r.code).toBe(1);
    expect(r.out).not.toContain(ESC);
    expect(r.out).toContain('✖ missing.png');
    expect(r.out).toContain('1 failed');
  });

  it('adapts the table to a narrow terminal', async () => {
    const r = await exec(['encode', 'photos', '-r', '--no-color'], { tty: true, columns: 70 });
    for (const line of r.out.split('\n')) expect(Array.from(line).length).toBeLessThanOrEqual(100);
    expect(r.out).toContain('Value');
    expect(r.out).not.toContain('Smaller  ');
  });

  it('stays plain when piped even with several images', async () => {
    const r = await exec(['encode', 'photos'], { tty: false });
    expect(r.out).not.toContain('HazeHash');
  });
});

describe('decode', () => {
  let hash: string;
  beforeAll(async () => {
    hash = (await exec(['encode', 'photos/a.png'])).out.trim();
  });

  it('draws half-block colours in a colour terminal', async () => {
    const r = await exec(['decode', hash], { tty: true, env: { COLORTERM: 'truecolor' } });
    expect(r.code).toBe(0);
    expect(r.out).toContain('▀');
    expect(r.out).toContain(`${ESC}[38;2;`);
    expect(stripAnsi(r.out)).toMatch(/32×2[45] preview/);
    expect(stripAnsi(r.out)).toContain('average colour #');
  });

  it('falls back to characters without colour', async () => {
    const r = await exec(['decode', hash]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain(ESC);
    expect(r.out).not.toContain('▀');
  });

  it('honours --size', async () => {
    const r = await exec(['decode', hash, '--size', '16', '--no-color']);
    expect(r.out).toMatch(/16×1[23] preview/);
  });

  it('saves an image with --output and --scale', async () => {
    const r = await exec(['decode', hash, '-o', 'preview.png', '--scale', '4']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('saved preview.png');
    const meta = await sharp(join(root, 'preview.png')).metadata();
    expect(meta.width).toBe(128);
    expect([96, 100]).toContain(meta.height);
  });

  it('reads the hash from standard input', async () => {
    const stdin = new TextEncoder().encode(`${hash}\n`);
    const r = await exec(['decode', '-', '--no-color'], { stdin });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/32×2[45] preview/);
  });

  it('explains invalid hashes', async () => {
    const chars = await exec(['decode', 'not a hash!!']);
    expect(chars.code).toBe(1);
    expect(chars.err).toContain('base64url alphabet');
    const length = await exec(['decode', 'abc']);
    expect(length.code).toBe(1);
    expect(length.err).toContain('length is not valid');
    // First two bits set: an unknown format version.
    const version = await exec(['decode', '____________']);
    expect(version.code).toBe(1);
    expect(version.err).toContain('newer format version');
  });
});

describe('info', () => {
  it('explains a hash', async () => {
    const hash = (await exec(['encode', 'photos/deep/c.png'])).out.trim();
    const r = await exec(['info', hash]);
    expect(r.code).toBe(0);
    for (const label of [
      'Size',
      'Aspect ratio',
      'Transparency',
      'Brightness grid',
      'Average colour',
    ]) {
      expect(r.out).toContain(label);
    }
    expect(r.out).toMatch(/\d+:\d+ \(1\.\d\d\)/);
    expect(r.out).toContain('stored');
  });

  it('prints json', async () => {
    const hash = (await exec(['encode', 'photos/a.png'])).out.trim();
    const facts = JSON.parse((await exec(['info', hash, '--json'])).out);
    expect(facts).toMatchObject({ hash, version: 1, alpha: false });
    expect(facts.aspectRatio).toBeGreaterThan(1.25);
    expect(facts.aspectRatio).toBeLessThan(1.42);
    expect(facts.nearestRatio).toMatch(/^\d+:\d+$/);
    expect(facts.bytes).toBeLessThanOrEqual(28);
  });

  it('rejects invalid hashes', async () => {
    const r = await exec(['info', 'zzz zzz']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('not a HazeHash');
  });
});

describe('inputs', () => {
  it('reports what matched nothing', async () => {
    const result = await expandInputs(['nothing/*.png', 'photos'], {
      cwd: root,
      recursive: false,
      ignoreCase: false,
    });
    expect(result.unmatched).toEqual(['nothing/*.png']);
    expect(result.files).toHaveLength(2);
  });
});
