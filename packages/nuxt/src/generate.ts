import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

export interface SourceDir {
  /** Directory to scan, relative to the project root unless absolute. */
  dir: string;
  /** URL prefix of the directory's files in the manifest keys. Default '/'. */
  prefix?: string;
}

export interface GenerateOptions {
  dirs: SourceDir[];
  extensions: string[];
  budget: number;
  profile: 'fast' | 'default' | 'high';
  /** Cache file; hashes of unchanged files are reused between builds. */
  cacheFile?: string;
}

export type Manifest = Record<string, string>;
export type EncodeFile = (
  path: string,
  options: { budget: number; profile: 'fast' | 'default' | 'high' },
) => Promise<string>;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  budget: number;
  profile: string;
  hash: string;
}

/** All image files below `dir` whose extension is in `extensions`, sorted. */
export async function scanImages(dir: string, extensions: string[]): Promise<string[]> {
  const wanted = new Set(extensions.map((e) => e.toLowerCase()));
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await scanImages(path, extensions)));
    else if (wanted.has(extname(entry.name).toLowerCase())) out.push(path);
  }
  return out.sort();
}

/** Manifest key of a file: URL prefix plus the path relative to its source directory. */
export function manifestKey(file: string, source: { dir: string; prefix?: string }): string {
  const prefix = (source.prefix ?? '/').replace(/\/?$/, '/');
  return prefix + relative(source.dir, file).split('\\').join('/');
}

async function readCache(file: string | undefined): Promise<Record<string, CacheEntry>> {
  if (!file) return {};
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

/**
 * Builds a `{ url: hash }` manifest. Files that fail to encode are skipped with a warning
 * so a single broken image never fails the build.
 */
export async function buildManifest(
  rootDir: string,
  options: GenerateOptions,
  encodeFile: EncodeFile,
  warn: (message: string) => void = () => {},
): Promise<Manifest> {
  const cache = await readCache(options.cacheFile);
  const next: Record<string, CacheEntry> = {};
  const manifest: Manifest = {};
  const jobs: Array<() => Promise<void>> = [];

  for (const source of options.dirs) {
    const dir = resolve(rootDir, source.dir);
    for (const file of await scanImages(dir, options.extensions)) {
      const key = manifestKey(file, { dir, prefix: source.prefix });
      jobs.push(async () => {
        try {
          const info = await stat(file);
          const hit = cache[file];
          if (
            hit &&
            hit.mtimeMs === info.mtimeMs &&
            hit.size === info.size &&
            hit.budget === options.budget &&
            hit.profile === options.profile
          ) {
            manifest[key] = hit.hash;
            next[file] = hit;
            return;
          }
          const hash = await encodeFile(file, { budget: options.budget, profile: options.profile });
          manifest[key] = hash;
          next[file] = {
            mtimeMs: info.mtimeMs,
            size: info.size,
            budget: options.budget,
            profile: options.profile,
            hash,
          };
        } catch (error) {
          warn(`[hazehash] skipped ${file}: ${(error as Error).message}`);
        }
      });
    }
  }

  // Bounded concurrency: image decoding is memory hungry.
  const workers = Array.from({ length: Math.min(4, jobs.length) }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) await job();
  });
  await Promise.all(workers);

  if (options.cacheFile) {
    await mkdir(dirname(options.cacheFile), { recursive: true });
    await writeFile(options.cacheFile, JSON.stringify(next));
  }
  // Stable key order keeps generated files deterministic.
  return Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
}
