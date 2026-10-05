#!/usr/bin/env node
import { encodeFile } from './node';
import { toBase64Url } from './encoder/base64';
import type { EncodeOptions } from './types';

const USAGE = `Usage: hazehash encode <file> [--budget N] [--profile fast|default|high]
                              [--analysis-size N] [--alpha auto|true|false] [--hex]

Prints the HazeHash of an image as base64url (or hex with --hex).`;

async function main(argv: string[]): Promise<number> {
  const [command, file, ...rest] = argv;
  if (command !== 'encode' || !file) {
    console.error(USAGE);
    return command === '--help' || command === '-h' ? 0 : 1;
  }
  const options: EncodeOptions = {};
  let hex = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--hex') hex = true;
    else if (flag === '--budget') options.budget = Number(rest[++i]);
    else if (flag === '--analysis-size') options.analysisSize = Number(rest[++i]);
    else if (flag === '--profile') options.profile = rest[++i] as EncodeOptions['profile'];
    else if (flag === '--alpha') {
      const v = rest[++i];
      options.alpha = v === 'true' ? true : v === 'false' ? false : 'auto';
    } else {
      console.error(`Unknown option ${flag}\n${USAGE}`);
      return 1;
    }
  }
  const bytes = await encodeFile(file, options);
  console.log(hex ? Buffer.from(bytes).toString('hex') : toBase64Url(bytes));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(err.message);
    process.exit(1);
  },
);
