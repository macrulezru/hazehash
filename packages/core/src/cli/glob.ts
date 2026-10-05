import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/** Extensions picked up when an input is a folder or a glob. */
export const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.gif',
  '.tif',
  '.tiff',
];

export function hasGlob(input: string): boolean {
  return /[*?]/.test(input);
}

const slash = (p: string) => p.split('\\').join('/');

/** Converts a glob (`*`, `**`, `?`) into a regular expression over '/'-separated paths. */
export function globToRegExp(glob: string, ignoreCase = false): RegExp {
  let source = '';
  const pattern = slash(glob);
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') {
          i++;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (c === '?') {
      source += '[^/]';
    } else {
      source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, ignoreCase ? 'i' : '');
}

const isImage = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTENSIONS.includes(name.slice(dot).toLowerCase());
};

async function walk(dir: string, maxDepth: number, depth = 0): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < maxDepth && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        out.push(...(await walk(path, maxDepth, depth + 1)));
      }
    } else {
      out.push(path);
    }
  }
  return out;
}

export interface Expanded {
  /** Absolute paths of the images found, in input order (sorted within each input). */
  files: string[];
  /** Inputs that matched nothing. */
  unmatched: string[];
}

/**
 * Turns the inputs (files, folders, globs) into a list of image files.
 * A folder yields its images (and those of sub-folders with `recursive`); a glob is matched
 * against paths relative to `cwd`; a plain file is taken as is, whatever its extension.
 */
export async function expandInputs(
  inputs: string[],
  options: { cwd: string; recursive: boolean; ignoreCase: boolean },
): Promise<Expanded> {
  const files: string[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  const add = (list: string[]) => {
    for (const file of list) {
      if (!seen.has(file)) {
        seen.add(file);
        files.push(file);
      }
    }
  };

  for (const input of inputs) {
    if (hasGlob(input)) {
      const normalized = slash(input);
      const segments = normalized.split('/');
      const firstGlob = segments.findIndex((s) => hasGlob(s));
      const base = resolve(options.cwd, segments.slice(0, firstGlob).join('/') || '.');
      const deep = normalized.includes('**');
      const maxDepth = deep ? Infinity : segments.length - firstGlob - 1;
      const re = globToRegExp(slash(resolve(options.cwd, normalized)), options.ignoreCase);
      const found = (await walk(base, maxDepth))
        .filter((f) => re.test(slash(f)) && isImage(f))
        .sort();
      if (found.length) add(found);
      else unmatched.push(input);
      continue;
    }
    const path = resolve(options.cwd, input);
    let info;
    try {
      info = await stat(path);
    } catch {
      unmatched.push(input);
      continue;
    }
    if (info.isDirectory()) {
      const found = (await walk(path, options.recursive ? Infinity : 0)).filter(isImage).sort();
      if (found.length) add(found);
      else unmatched.push(input);
    } else {
      add([path]);
    }
  }
  return { files, unmatched };
}

/** A short label for a file: its path relative to `cwd`, with '/' separators. */
export function labelOf(file: string, cwd: string): string {
  const rel = slash(relative(cwd, file));
  return rel && !rel.startsWith('../') ? rel : slash(file);
}
