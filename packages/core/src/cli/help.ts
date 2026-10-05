import { padEnd, wrap } from './format';
import type { Style } from './style';

export const REPO_URL = 'https://github.com/macrulezru/hazehash';

interface Row {
  term: string;
  desc: string;
}

const WIDTH = 78;

function heading(s: Style, title: string): string {
  return `\n${s.bold(s.yellow(title))}\n`;
}

/** Aligned two-column list: a term on the left, a wrapped explanation on the right. */
function rows(s: Style, list: Row[], paint: (t: string) => string = s.cyan): string {
  const termWidth = Math.min(30, Math.max(...list.map((r) => r.term.length)) + 2);
  const lines: string[] = [];
  for (const row of list) {
    const text = wrap(row.desc, WIDTH - 2 - termWidth);
    const first = row.term.length + 2 > termWidth ? [paint(row.term)] : [];
    if (first.length) lines.push(`  ${first[0]}`);
    text.forEach((line, i) => {
      const term =
        i === 0 && !first.length ? padEnd(paint(row.term), termWidth) : ' '.repeat(termWidth);
      lines.push(`  ${term}${line}`);
    });
  }
  return lines.join('\n') + '\n';
}

function title(s: Style, version: string): string {
  return (
    `${s.bold(s.magenta('HazeHash'))} ${s.dim(`v${version}`)}  ` +
    `${s.dim('compact image placeholders: 16–48 byte hashes that rebuild a blurred preview')}\n`
  );
}

const GLOBAL_OPTIONS: Row[] = [
  { term: '-h, --help', desc: 'Show help. Works for every command: hazehash encode --help' },
  { term: '-V, --version', desc: 'Print the version.' },
  {
    term: '--color, --no-color',
    desc: 'Force colours on or off. Colours are also off when output is piped, when NO_COLOR is set and on a "dumb" terminal.',
  },
];

export function mainHelp(s: Style, version: string): string {
  return [
    title(s, version),
    heading(s, 'USAGE'),
    `  ${s.green('hazehash')} ${s.cyan('<command>')} ${s.dim('[options]')}\n`,
    heading(s, 'COMMANDS'),
    rows(
      s,
      [
        {
          term: 'encode <images…>',
          desc: 'Create hashes from image files, folders, globs ("photos/**/*.jpg") or standard input ("-").',
        },
        {
          term: 'decode <hash>',
          desc: 'Draw the preview a hash stands for in the terminal, or save it as an image file.',
        },
        {
          term: 'info <hash>',
          desc: 'Explain what is stored inside a hash: aspect ratio, grids, average colour, detail level.',
        },
      ],
      s.green,
    ),
    heading(s, 'OPTIONS'),
    rows(s, GLOBAL_OPTIONS),
    heading(s, 'EXAMPLES'),
    [
      `  ${s.dim('# hash of one image, printed alone (handy in scripts)')}`,
      '  hazehash encode photo.jpg',
      '',
      `  ${s.dim('# every image of a folder as JSON, saved to a file')}`,
      '  hazehash encode ./images --format json -o hashes.json',
      '',
      `  ${s.dim('# see what a hash looks like')}`,
      '  hazehash decode Ef90QP3dAP7_773v3y-6uqjYQIqBEaRAVVEpEA',
      '',
    ].join('\n'),
    `\n${s.dim('Run')} hazehash <command> --help ${s.dim('for the options of a command.')}\n`,
    `${s.dim(`Documentation and issues: ${REPO_URL}`)}\n`,
  ].join('');
}

export function encodeHelp(s: Style, version: string): string {
  return [
    title(s, version),
    heading(s, 'USAGE'),
    `  ${s.green('hazehash encode')} ${s.cyan('<input…>')} ${s.dim('[options]')}\n`,
    '\n  An input is an image file, a folder, a glob such as "photos/**/*.jpg" (quote it so your\n  shell does not expand it), or "-" to read one image from standard input.\n',
    heading(s, 'HASH OPTIONS'),
    rows(s, [
      {
        term: '-b, --budget <bytes>',
        desc: 'Maximum size of one hash in bytes, header included (7 bytes, 9 with alpha, is the minimum). Default 28. More bytes keep more detail, see the guide below.',
      },
      {
        term: '-p, --profile <name>',
        desc: 'How hard the encoder searches. "fast" is about 1 ms per image, "default" about 5 ms, "high" refines the result for about 1% less error. Default "default".',
      },
      {
        term: '-a, --analysis-size <px>',
        desc: 'Long side of the downscaled image the hash is computed from, 32–128. Default 64; larger rarely helps.',
      },
      {
        term: '--alpha <mode>',
        desc: '"auto" stores transparency only when the image has some (default), "true" always stores it, "false" never does.',
      },
    ]),
    heading(s, 'WHICH IMAGES'),
    rows(s, [
      {
        term: '-r, --recursive',
        desc: 'Also search sub-folders when an input is a folder (a glob with ** always does).',
      },
    ]),
    heading(s, 'OUTPUT'),
    rows(s, [
      {
        term: '-f, --format <kind>',
        desc: '"text": the hash alone for one image, "path<TAB>hash" lines for several. "json": an object { "path": "hash" }. "csv": a table with a header row. Default "text".',
      },
      {
        term: '--details',
        desc: 'json and csv also get the hash size, the image size and the file size.',
      },
      { term: '--hex', desc: 'Write hashes as hex instead of base64url.' },
      {
        term: '-o, --output <file>',
        desc: 'Write the result to a file instead of standard output.',
      },
      {
        term: '--pretty, --plain',
        desc: 'Pretty is a coloured table with a summary and is the default in a terminal; plain is for scripts and is the default when output is piped.',
      },
      { term: '-q, --quiet', desc: 'No progress and no summary, only the result and errors.' },
    ]),
    heading(s, 'BUDGET GUIDE'),
    rows(
      s,
      [
        { term: '16 bytes', desc: '22 characters. Smallest practical hash, rough colours.' },
        { term: '24 bytes', desc: '32 characters. Good compromise when storage matters.' },
        {
          term: '28 bytes',
          desc: '38 characters. The default, about 20% lower error than ThumbHash.',
        },
        { term: '36 bytes', desc: '48 characters. More detail where size is no issue.' },
      ],
      s.yellow,
    ),
    heading(s, 'EXIT CODES'),
    rows(
      s,
      [
        { term: '0', desc: 'Every image was encoded.' },
        { term: '1', desc: 'At least one input failed (the others are still written).' },
        { term: '2', desc: 'Wrong command line.' },
      ],
      s.gray,
    ),
    heading(s, 'EXAMPLES'),
    [
      '  hazehash encode photo.jpg --budget 24',
      '  hazehash encode "images/**/*.jpg" -f csv --details',
      '  hazehash encode ./images -r -f json -o hashes.json',
      '  cat photo.jpg | hazehash encode -',
      '',
    ].join('\n'),
    `\n${s.dim('Reading image files needs the optional package sharp: npm install --save-dev sharp')}\n`,
  ].join('');
}

export function decodeHelp(s: Style, version: string): string {
  return [
    title(s, version),
    heading(s, 'USAGE'),
    `  ${s.green('hazehash decode')} ${s.cyan('<hash>')} ${s.dim('[options]')}\n`,
    '\n  Rebuilds the blurred preview from a hash. Without --output the preview is drawn in the\n  terminal with coloured half-blocks, so a colour terminal is needed. Use "-" as the hash to\n  read it from standard input.\n',
    heading(s, 'OPTIONS'),
    rows(s, [
      {
        term: '-o, --output <file>',
        desc: 'Save the preview as an image; the format follows the extension (.png, .webp, .jpg). Needs sharp.',
      },
      { term: '-s, --size <px>', desc: 'Long side of the decoded preview, 4–128. Default 32.' },
      {
        term: '--scale <n>',
        desc: 'With --output: enlarge the saved image n times with smooth interpolation, 1–32. Default 8.',
      },
      { term: '--no-dither', desc: 'Turn off the deterministic dithering that hides banding.' },
    ]),
    heading(s, 'EXAMPLES'),
    [
      '  hazehash decode Ef90QP3dAP7_773v3y-6uqjYQIqBEaRAVVEpEA',
      '  hazehash decode Ef90QP3dAP7_773v3y-6uqjYQIqBEaRAVVEpEA -o preview.png --scale 16',
      '',
    ].join('\n'),
  ].join('');
}

export function infoHelp(s: Style, version: string): string {
  return [
    title(s, version),
    heading(s, 'USAGE'),
    `  ${s.green('hazehash info')} ${s.cyan('<hash>')} ${s.dim('[options]')}\n`,
    '\n  Reads only the header of a hash and explains it: the size, the aspect ratio, how many\n  frequency components are stored for brightness and colour, the average colour and whether\n  transparency is included. Use "-" to read the hash from standard input.\n',
    heading(s, 'OPTIONS'),
    rows(s, [{ term: '--json', desc: 'Print the same facts as JSON.' }]),
    heading(s, 'EXAMPLE'),
    '  hazehash info Ef90QP3dAP7_773v3y-6uqjYQIqBEaRAVVEpEA\n',
  ].join('');
}
