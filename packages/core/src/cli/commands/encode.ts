import { stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getAverageColor } from '../../decode';
import { PlaceholderError } from '../../errors';
import { encodeFileDetailed, type EncodedFile } from '../../node';
import { loadSharp } from '../../sharp';
import type { EncodeOptions } from '../../types';
import { enumOption, intOption, UsageError, type OptionSpec, type Parsed } from '../args';
import {
  formatBytes,
  formatDuration,
  formatInt,
  padEnd,
  padStart,
  swatch,
  toHex,
  truncateMiddle,
  wrap,
} from '../format';
import { expandInputs, labelOf } from '../glob';
import { EXIT, type Io } from '../io';
import { visibleLength, type Style } from '../style';

export const ENCODE_OPTIONS: OptionSpec[] = [
  { long: 'budget', short: 'b', kind: 'value' },
  { long: 'profile', short: 'p', kind: 'value' },
  { long: 'analysis-size', short: 'a', kind: 'value' },
  { long: 'alpha', kind: 'value' },
  { long: 'recursive', short: 'r', kind: 'flag' },
  { long: 'format', short: 'f', kind: 'value' },
  { long: 'details', kind: 'flag' },
  { long: 'hex', kind: 'flag' },
  { long: 'output', short: 'o', kind: 'value' },
  { long: 'pretty', kind: 'flag' },
  { long: 'plain', kind: 'flag' },
  { long: 'quiet', short: 'q', kind: 'flag' },
];

export interface Context {
  io: Io;
  /** Styles for standard output and standard error (each depends on its own stream). */
  out: Style;
  err: Style;
  version: string;
}

interface Item {
  label: string;
  /** Path of a file, or the bytes read from standard input. */
  source: string | Uint8Array;
  fileBytes?: number;
}

interface Done {
  ok: true;
  label: string;
  file: EncodedFile;
  fileBytes: number;
  /** The hash in the representation the user asked for (base64url or hex). */
  text: string;
}

interface Failed {
  ok: false;
  label: string;
  message: string;
}

type Outcome = Done | Failed;

const CONCURRENCY = 4;

function describeError(error: unknown, options: EncodeOptions): string {
  if (error instanceof PlaceholderError && error.code === 'BudgetTooSmall') {
    return `budget ${options.budget ?? 28} is too small: a hash needs at least 7 bytes (9 with transparency)`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^[A-Za-z]+Error: /, '').replace(/^InvalidInput: /, '');
}

/** Runs `work` over `items` with a few at a time and reports finished jobs in order. */
async function pool<T, R>(
  items: T[],
  work: (item: T) => Promise<R>,
  onProgress: (finished: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let finished = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i]);
      onProgress(++finished);
    }
  });
  await Promise.all(workers);
  return results;
}

const csvCell = (value: string | number) => {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function plainOutput(done: Done[], format: string, details: boolean, single: boolean): string {
  if (format === 'json') {
    const object: Record<string, unknown> = {};
    for (const d of done) {
      object[d.label] = details
        ? {
            hash: d.text,
            bytes: d.file.bytes.length,
            width: d.file.width,
            height: d.file.height,
            fileBytes: d.fileBytes,
          }
        : d.text;
    }
    return JSON.stringify(object, null, 2) + '\n';
  }
  if (format === 'csv') {
    const head = details ? 'file,hash,bytes,width,height,fileBytes' : 'file,hash';
    const lines = done.map((d) =>
      details
        ? [d.label, d.text, d.file.bytes.length, d.file.width, d.file.height, d.fileBytes]
            .map(csvCell)
            .join(',')
        : [d.label, d.text].map(csvCell).join(','),
    );
    return [head, ...lines].join('\n') + '\n';
  }
  return single ? `${done[0].text}\n` : done.map((d) => `${d.label}\t${d.text}`).join('\n') + '\n';
}

interface Column {
  header: string;
  cells: string[];
  right?: boolean;
  /** Lower numbers are dropped first when the terminal is too narrow. */
  dropOrder?: number;
}

function prettyOutput(
  done: Done[],
  failed: Failed[],
  ctx: Context,
  elapsed: number,
  o: EncodeOptions,
) {
  const { out: s, io } = ctx;
  const width = io.stdout.columns ?? 100;
  const lines: string[] = [];

  lines.push(
    `${s.bold(s.magenta('HazeHash'))} ${s.bold('encode')}  ${s.dim(
      `budget ${o.budget ?? 28} B · profile ${o.profile ?? 'default'} · alpha ${String(o.alpha ?? 'auto')}`,
    )}`,
    '',
  );

  if (done.length) {
    const colour = done.map((d) => {
      const c = getAverageColor(d.file.bytes);
      return { rgb: c, hex: toHex(c) };
    });
    const columns: Column[] = [
      { header: 'Image', cells: done.map((d) => d.label) },
      {
        header: 'Pixels',
        cells: done.map((d) => `${d.file.width}×${d.file.height}`),
        right: true,
        dropOrder: 3,
      },
      {
        header: 'File',
        cells: done.map((d) => formatBytes(d.fileBytes)),
        right: true,
        dropOrder: 2,
      },
      { header: 'Hash', cells: done.map((d) => `${d.file.bytes.length} B`), right: true },
      {
        header: 'Colour',
        cells: colour.map((c) => `${swatch(s, c.rgb)} ${s.dim(c.hex)}`.trim()),
        dropOrder: 1,
      },
      { header: 'Value', cells: done.map((d) => s.green(d.text)) },
      {
        header: 'Smaller',
        cells: done.map((d) => `${formatInt(Math.round(d.fileBytes / d.file.bytes.length))}×`),
        right: true,
        dropOrder: 0,
      },
    ];
    const gap = 2;
    const total = (cols: Column[], image: number) =>
      4 + cols.reduce((sum, c, i) => sum + (i === 0 ? image : widthOf(c)) + gap, 0);
    const widthOf = (c: Column) => Math.max(visibleLength(c.header), ...c.cells.map(visibleLength));
    let shown = columns.slice();
    let imageWidth = widthOf(columns[0]);
    // Make room: shorten long file names a little, then drop the least important columns,
    // and only as a last resort shorten the names further.
    const tooWide = () => total(shown, imageWidth) > width;
    while (tooWide()) {
      const droppable = shown
        .filter((c) => c.dropOrder !== undefined)
        .sort((x, y) => (x.dropOrder as number) - (y.dropOrder as number))[0];
      if (imageWidth > 28) imageWidth--;
      else if (droppable) shown = shown.filter((c) => c !== droppable);
      else if (imageWidth > 16) imageWidth--;
      else break;
    }
    shown[0] = {
      ...shown[0],
      cells: shown[0].cells.map((cell) => truncateMiddle(cell, imageWidth)),
    };
    const sizes = shown.map((c, i) => (i === 0 ? imageWidth : widthOf(c)));
    const fit = (c: Column, text: string, w: number) =>
      c.right ? padStart(text, w) : c === shown[shown.length - 1] ? text : padEnd(text, w);

    lines.push(
      '    ' + shown.map((c, i) => s.dim(fit(c, c.header, sizes[i]))).join(' '.repeat(gap)),
    );
    done.forEach((_, row) => {
      lines.push(
        `  ${s.green('✔')} ` +
          shown.map((c, i) => fit(c, c.cells[row], sizes[i])).join(' '.repeat(gap)),
      );
    });
    lines.push('');
  }

  for (const f of failed) {
    lines.push(`  ${s.red('✖')} ${s.bold(f.label)}  ${s.red(f.message)}`);
  }
  if (failed.length) lines.push('');

  const originals = done.reduce((sum, d) => sum + d.fileBytes, 0);
  const hashes = done.reduce((sum, d) => sum + d.file.bytes.length, 0);
  const parts: string[] = [];
  if (done.length) {
    parts.push(
      s.green(`✔ ${formatInt(done.length)} hash${done.length === 1 ? '' : 'es'}`),
      `${formatBytes(originals)} → ${formatInt(hashes)} B`,
      `${formatInt(Math.round(originals / Math.max(1, hashes)))}× smaller`,
    );
  }
  if (failed.length) parts.push(s.red(`✖ ${failed.length} failed`));
  parts.push(s.dim(formatDuration(elapsed)));
  lines.push(parts.join(s.dim(' · ')));

  if (done.length && !ctx.io.env.HAZEHASH_NO_LEGEND) {
    lines.push('');
    const legend =
      'Hash is the size of the string to store and Value is the string itself (base64url). ' +
      'Colour is the average colour, read back from the hash alone. Smaller is the file size divided by the hash size.';
    for (const line of wrap(legend, Math.min(width, 100) - 2)) lines.push(`  ${s.dim(line)}`);
  }
  return lines.join('\n') + '\n';
}

export async function encodeCommand(parsed: Parsed, ctx: Context): Promise<number> {
  const { io, err: e } = ctx;
  const budget = intOption(parsed, 'budget', { min: 1, max: 1024 });
  const profile = enumOption(parsed, 'profile', ['fast', 'default', 'high'] as const);
  const analysisSize = intOption(parsed, 'analysis-size', { min: 32, max: 128 });
  const alphaMode = enumOption(parsed, 'alpha', ['auto', 'true', 'false'] as const);
  const format = enumOption(parsed, 'format', ['text', 'json', 'csv'] as const) ?? 'text';
  if (parsed.flags.has('pretty') && parsed.flags.has('plain')) {
    throw new UsageError('--pretty and --plain cannot be used together');
  }
  if (!parsed.positionals.length) {
    throw new UsageError(
      'No input given',
      'Pass an image, a folder or a glob, for example: hazehash encode photo.jpg',
    );
  }

  const options: EncodeOptions = {};
  if (budget !== undefined) options.budget = budget;
  if (profile) options.profile = profile;
  if (analysisSize !== undefined) options.analysisSize = analysisSize;
  if (alphaMode) options.alpha = alphaMode === 'auto' ? 'auto' : alphaMode === 'true';
  const hex = parsed.flags.has('hex');
  const details = parsed.flags.has('details');
  const quiet = parsed.flags.has('quiet');
  const output = parsed.values.get('output');
  const pretty =
    format === 'text' &&
    (parsed.flags.has('pretty') || (!parsed.flags.has('plain') && io.stdout.isTTY));

  // Reading images needs sharp; say so once instead of once per file.
  try {
    await loadSharp();
  } catch (error) {
    io.stderr.write(
      `${e.red('✖')} ${(error as Error).message.replace(/^InvalidInput: /, '')}\n` +
        `  ${e.dim('Install it with:')} npm install --save-dev sharp\n`,
    );
    return EXIT.failed;
  }

  const started = io.now();
  const items: Item[] = [];
  const failures: Failed[] = [];
  const paths: string[] = [];
  for (const input of parsed.positionals) {
    if (input === '-') {
      const bytes = await io.readStdin();
      if (bytes.length) items.push({ label: 'stdin', source: bytes, fileBytes: bytes.length });
      else failures.push({ ok: false, label: 'stdin', message: 'no data on standard input' });
    } else {
      paths.push(input);
    }
  }
  const expanded = await expandInputs(paths, {
    cwd: io.cwd,
    recursive: parsed.flags.has('recursive'),
    ignoreCase: io.platform === 'win32',
  });
  for (const input of expanded.unmatched) {
    failures.push({ ok: false, label: input, message: 'no image found' });
  }
  for (const file of expanded.files) items.push({ label: labelOf(file, io.cwd), source: file });

  const showProgress = io.stderr.isTTY && !quiet && items.length > 1;
  const outcomes = await pool<Item, Outcome>(
    items,
    async (item) => {
      try {
        const file = await encodeFileDetailed(item.source, options);
        const fileBytes = item.fileBytes ?? (await stat(item.source as string)).size;
        const text = hex ? Buffer.from(file.bytes).toString('hex') : file.hash;
        return { ok: true, label: item.label, file, fileBytes, text };
      } catch (error) {
        return { ok: false, label: item.label, message: describeError(error, options) };
      }
    },
    (finished) => {
      if (showProgress) {
        io.stderr.write(`\r\x1b[K${e.dim(`Encoding ${finished}/${items.length}…`)}`);
      }
    },
  );
  if (showProgress) io.stderr.write('\r\x1b[K');

  const done = outcomes.filter((o): o is Done => o.ok);
  const failed = [...failures, ...outcomes.filter((o): o is Failed => !o.ok)];
  const elapsed = io.now() - started;

  if (done.length && (output || !pretty)) {
    const text = plainOutput(
      done,
      format,
      details,
      parsed.positionals.length === 1 && items.length === 1 && !failures.length,
    );
    if (output) await writeFile(resolve(io.cwd, output), text);
    else io.stdout.write(text);
  }
  if (pretty) {
    io.stdout.write(prettyOutput(done, failed, ctx, elapsed, options));
  } else {
    for (const f of failed) io.stderr.write(`${e.red('✖')} ${e.bold(f.label)}: ${f.message}\n`);
    if (output && done.length && !quiet) {
      io.stderr.write(
        `${e.green('✔')} wrote ${done.length} hash${done.length === 1 ? '' : 'es'} to ${output}\n`,
      );
    } else if (io.stderr.isTTY && !quiet && done.length && items.length > 1) {
      io.stderr.write(
        `${e.green('✔')} ${done.length} hashes ${e.dim(`in ${formatDuration(elapsed)}`)}\n`,
      );
    }
  }
  return failed.length ? EXIT.failed : EXIT.ok;
}
