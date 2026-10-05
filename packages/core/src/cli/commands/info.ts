import { toBytes } from '../../base64';
import { getAverageColor } from '../../decode';
import { PlaceholderError } from '../../errors';
import { codeToAspect, headerSize, outputSize, readHeader } from '../../format';
import { buildOrder } from '../../layout';
import { dcDequantize } from '../../quant';
import { UsageError, type OptionSpec, type Parsed } from '../args';
import { padEnd, swatch, toHex } from '../format';
import { EXIT } from '../io';
import type { Context } from './encode';
import { explainHashError, readHashArgument } from './hash-input';

export const INFO_OPTIONS: OptionSpec[] = [{ long: 'json', kind: 'flag' }];

/** The simple ratio n:m (both up to 20) closest to `r`, e.g. 1.5 gives "3:2". */
export function nearestRatio(r: number): string {
  let best = '1:1';
  let bestError = Infinity;
  for (let n = 1; n <= 20; n++) {
    for (let m = 1; m <= 20; m++) {
      const error = Math.abs(Math.log(n / m / r));
      if (error < bestError - 1e-9) {
        bestError = error;
        best = `${n}:${m}`;
      }
    }
  }
  return best;
}

export async function infoCommand(parsed: Parsed, ctx: Context): Promise<number> {
  const { io, out: s } = ctx;
  if (parsed.positionals.length !== 1) {
    throw new UsageError(
      parsed.positionals.length ? 'Give exactly one hash' : 'No hash given',
      'Example: hazehash info Ef90QP3dAP7_773v3y-6uqjYQIqBEaRAVVEpEA',
    );
  }
  const hash = await readHashArgument(parsed.positionals[0], io);
  let bytes: Uint8Array;
  let h;
  try {
    bytes = toBytes(hash);
    h = readHeader(bytes);
  } catch (error) {
    io.stderr.write(`${ctx.err.red('✖')} ${explainHashError(error as PlaceholderError)}\n`);
    return EXIT.failed;
  }

  const ratio = codeToAspect(h.aspectCode);
  const [pw, ph] = outputSize(ratio, 32);
  const average = getAverageColor(bytes);
  const stored = buildOrder(h).length;
  const header = headerSize(h.alpha);
  const luma = [dcDequantize(0, h.dc[0]), dcDequantize(1, h.dc[1]), dcDequantize(2, h.dc[2])];

  const facts = {
    hash,
    characters: hash.length,
    bytes: bytes.length,
    headerBytes: header,
    dataBytes: bytes.length - header,
    version: 1,
    aspectRatio: Number(ratio.toFixed(4)),
    nearestRatio: nearestRatio(ratio),
    alpha: h.alpha,
    lumaGrid: [h.Lx, h.Ly],
    chromaGrid: [h.Cx, h.Cy],
    alphaGrid: h.alpha ? [h.Ax, h.Ay] : null,
    storedCoefficients: stored,
    averageColor: toHex(average),
    averageOklab: luma.map((v) => Number(v.toFixed(3))),
    riceParameters: h.k.slice(0, h.alpha ? 4 : 3),
    scaleCodes: h.scale.slice(0, h.alpha ? 4 : 3),
  };
  if (parsed.flags.has('json')) {
    io.stdout.write(JSON.stringify(facts, null, 2) + '\n');
    return EXIT.ok;
  }

  const row = (label: string, value: string, note: string) =>
    `  ${s.bold(padEnd(label, 16))}${padEnd(value, 24)}${s.dim(note)}`;
  const lines = [
    `${s.bold(s.magenta('HazeHash'))} ${s.bold('info')}`,
    '',
    row('Hash', s.green(hash), ''),
    row(
      'Size',
      `${bytes.length} bytes`,
      `${hash.length} characters in base64url; header ${header} B + data ${bytes.length - header} B`,
    ),
    row('Format', 'version 1', 'the only version so far'),
    row(
      'Aspect ratio',
      `${facts.nearestRatio} (${facts.aspectRatio.toFixed(2)})`,
      `placeholder is drawn ${pw}×${ph} at 32 px; page layout should use the real image size`,
    ),
    row(
      'Transparency',
      h.alpha ? 'stored' : 'none',
      h.alpha ? `alpha grid ${h.Ax}×${h.Ay}` : 'the preview is opaque',
    ),
    row(
      'Brightness grid',
      `${h.Lx}×${h.Ly}`,
      'frequency components across × down; more means finer structure',
    ),
    row('Colour grid', `${h.Cx}×${h.Cy}`, 'colour needs fewer components than brightness'),
    row(
      'Coefficients',
      `${stored} stored`,
      'detail values after the header; a cut hash simply keeps fewer',
    ),
    row(
      'Average colour',
      `${swatch(s, average)} ${toHex(average)}`.trim(),
      `OKLab L ${luma[0].toFixed(2)}, a ${luma[1].toFixed(2)}, b ${luma[2].toFixed(2)}`,
    ),
    row(
      'Entropy coding',
      `Rice k = ${facts.riceParameters.join(', ')}`,
      'bits per value group for L, a, b (and alpha)',
    ),
  ];
  io.stdout.write(lines.join('\n') + '\n');
  return EXIT.ok;
}
