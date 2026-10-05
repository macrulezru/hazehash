import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildManifest, manifestKey, scanImages, type GenerateOptions } from '../src/generate';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hazehash-nuxt-'));
  await mkdir(join(root, 'public/images/nested'), { recursive: true });
  await writeFile(join(root, 'public/images/a.jpg'), 'a');
  await writeFile(join(root, 'public/images/B.PNG'), 'b');
  await writeFile(join(root, 'public/images/nested/c.webp'), 'c');
  await writeFile(join(root, 'public/images/readme.txt'), 'x');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const options = (extra: Partial<GenerateOptions> = {}): GenerateOptions => ({
  dirs: [{ dir: 'public', prefix: '/' }],
  extensions: ['.jpg', '.png', '.webp'],
  budget: 28,
  profile: 'default',
  ...extra,
});

describe('scanImages', () => {
  it('finds images recursively and ignores other files', async () => {
    const files = await scanImages(join(root, 'public'), ['.jpg', '.png', '.webp']);
    expect(
      files.map((f) =>
        f
          .slice(root.length + 1)
          .split('\\')
          .join('/'),
      ),
    ).toEqual(['public/images/B.PNG', 'public/images/a.jpg', 'public/images/nested/c.webp']);
  });

  it('returns nothing for a missing directory', async () => {
    expect(await scanImages(join(root, 'missing'), ['.jpg'])).toEqual([]);
  });
});

describe('manifestKey', () => {
  it('joins the prefix and the relative path with forward slashes', () => {
    expect(manifestKey(join('/p', 'img', 'a.jpg'), { dir: '/p', prefix: '/' })).toBe('/img/a.jpg');
    expect(manifestKey(join('/p', 'a.jpg'), { dir: '/p', prefix: '/static' })).toBe(
      '/static/a.jpg',
    );
  });
});

describe('buildManifest', () => {
  it('maps URLs to hashes in a stable order', async () => {
    const manifest = await buildManifest(root, options(), async (path) => `hash:${path.length}`);
    expect(Object.keys(manifest)).toEqual([
      '/images/a.jpg',
      '/images/B.PNG',
      '/images/nested/c.webp',
    ]);
  });

  it('skips files that fail to encode and warns', async () => {
    const warn = vi.fn();
    const manifest = await buildManifest(
      root,
      options(),
      async (path) => {
        if (path.endsWith('a.jpg')) throw new Error('boom');
        return 'ok';
      },
      warn,
    );
    expect(Object.keys(manifest)).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('boom');
  });

  it('reuses cached hashes for unchanged files and re-encodes changed ones', async () => {
    const cacheFile = join(root, 'cache/manifest.json');
    const encode = vi.fn(async (path: string) => `h-${path.length}`);
    await buildManifest(root, options({ cacheFile }), encode);
    expect(encode).toHaveBeenCalledTimes(3);

    await buildManifest(root, options({ cacheFile }), encode);
    expect(encode).toHaveBeenCalledTimes(3);

    const changed = join(root, 'public/images/a.jpg');
    await writeFile(changed, 'changed content');
    await utimes(changed, new Date(), new Date(Date.now() + 5000));
    await buildManifest(root, options({ cacheFile }), encode);
    expect(encode).toHaveBeenCalledTimes(4);

    await buildManifest(root, options({ cacheFile, budget: 20 }), encode);
    expect(encode).toHaveBeenCalledTimes(7);
  });
});
