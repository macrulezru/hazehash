import { extname, resolve } from 'node:path';
import { decode, getAverageColor } from '../../decode';
import { PlaceholderError } from '../../errors';
import { loadSharp } from '../../sharp';
import type { RgbaImage } from '../../types';
import { intOption, UsageError, type OptionSpec, type Parsed } from '../args';
import { formatDuration, swatch, toHex } from '../format';
import { EXIT } from '../io';
import type { Rgb, Style } from '../style';
import type { Context } from './encode';
import { readHashArgument, explainHashError } from './hash-input';

export const DECODE_OPTIONS: OptionSpec[] = [
  { long: 'output', short: 'o', kind: 'value' },
  { long: 'size', short: 's', kind: 'value' },
  { long: 'scale', kind: 'value' },
  { long: 'dither', kind: 'flag', negatable: true },
];

const CHECKER: [Rgb, Rgb] = [
  { r: 255, g: 255, b: 255 },
  { r: 204, g: 204, b: 204 },
];

/** The colour of pixel (x, y) over a checkerboard, so transparency stays visible. */
function composite(img: RgbaImage, x: number, y: number): Rgb {
  const o = (y * img.width + x) * 4;
  const a = img.data[o + 3] / 255;
  const back = CHECKER[((x >> 1) + (y >> 1)) & 1];
  return {
    r: Math.round(img.data[o] * a + back.r * (1 - a)),
    g: Math.round(img.data[o + 1] * a + back.g * (1 - a)),
    b: Math.round(img.data[o + 2] * a + back.b * (1 - a)),
  };
}

/** Draws the image with coloured half-blocks: two pixel rows per text row. */
export function renderBlocks(img: RgbaImage, s: Style): string[] {
  const lines: string[] = [];
  for (let y = 0; y < img.height; y += 2) {
    let line = '';
    for (let x = 0; x < img.width; x++) {
      const top = composite(img, x, y);
      const bottom = y + 1 < img.height ? composite(img, x, y + 1) : top;
      line += `${s.fg(top)}${s.bg(bottom)}▀`;
    }
    lines.push(line + s.reset);
  }
  return lines;
}

/** Fallback for terminals without colour: brightness as a character ramp. */
export function renderAscii(img: RgbaImage): string[] {
  const ramp = ' .:-=+*#%@';
  const lines: string[] = [];
  for (let y = 0; y < img.height; y += 2) {
    let line = '';
    for (let x = 0; x < img.width; x++) {
      const c = composite(img, x, y);
      const luma = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
      const ch = ramp[Math.min(ramp.length - 1, Math.floor((1 - luma) * ramp.length))];
      line += ch + ch;
    }
    lines.push(line);
  }
  return lines;
}

export async function decodeCommand(parsed: Parsed, ctx: Context): Promise<number> {
  const { io, out: s, err: e } = ctx;
  const size = intOption(parsed, 'size', { min: 4, max: 128 }) ?? 32;
  const scale = intOption(parsed, 'scale', { min: 1, max: 32 }) ?? 8;
  const output = parsed.values.get('output');
  const dither = !parsed.flags.has('no-dither');
  if (parsed.positionals.length !== 1) {
    throw new UsageError(
      parsed.positionals.length ? 'Give exactly one hash' : 'No hash given',
      'Example: hazehash decode Ef90QP3dAP7_773v3y-6uqjYQIqBEaRAVVEpEA',
    );
  }
  const hash = await readHashArgument(parsed.positionals[0], io);

  const started = io.now();
  let image: RgbaImage;
  try {
    image = decode(hash, { size, dither });
  } catch (error) {
    io.stderr.write(`${e.red('✖')} ${explainHashError(error as PlaceholderError)}\n`);
    return EXIT.failed;
  }
  const average = getAverageColor(hash);
  const took = io.now() - started;

  if (output) {
    const sharp = await loadSharp().catch((error: Error) => {
      io.stderr.write(
        `${e.red('✖')} ${error.message.replace(/^InvalidInput: /, '')}\n  ${e.dim('Install it with:')} npm install --save-dev sharp\n`,
      );
      return undefined;
    });
    if (!sharp) return EXIT.failed;
    const file = resolve(io.cwd, output);
    const ext = extname(file).toLowerCase();
    let pipeline = sharp(
      Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength),
      {
        raw: { width: image.width, height: image.height, channels: 4 },
      },
    );
    if (scale > 1) {
      pipeline = pipeline.resize(image.width * scale, image.height * scale, { kernel: 'cubic' });
    }
    if (ext === '.jpg' || ext === '.jpeg') pipeline = pipeline.flatten({ background: '#ffffff' });
    try {
      await pipeline.toFile(file);
    } catch (error) {
      io.stderr.write(`${e.red('✖')} cannot write ${output}: ${(error as Error).message}\n`);
      return EXIT.failed;
    }
    io.stdout.write(
      `${s.green('✔')} saved ${s.bold(output)} ${s.dim(
        `${image.width * scale}×${image.height * scale} px from a ${image.width}×${image.height} preview`,
      )}\n`,
    );
    return EXIT.ok;
  }

  const lines = s.depth >= 8 ? renderBlocks(image, s) : renderAscii(image);
  const out: string[] = [
    `${s.bold(s.magenta('HazeHash'))} ${s.bold('decode')}  ${s.dim(
      `${image.width}×${image.height} preview · decoded in ${formatDuration(took)}`,
    )}`,
    '',
    ...lines.map((line) => `  ${line}`),
    '',
    `  ${swatch(s, average)} ${s.dim(`average colour ${toHex(average)}`)}`,
    `  ${s.dim('Save it as an image with --output preview.png')}`,
  ];
  io.stdout.write(out.join('\n') + '\n');
  return EXIT.ok;
}
