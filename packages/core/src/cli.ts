#!/usr/bin/env node
import pkg from '../package.json';
import { EXIT, type Io } from './cli/io';
import { run } from './cli/main';

async function readStdin(): Promise<Uint8Array> {
  if (process.stdin.isTTY) {
    process.stderr.write('Reading from standard input; finish with Ctrl+D (Ctrl+Z on Windows)…\n');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const io: Io = {
  stdout: {
    write: (text) => void process.stdout.write(text),
    isTTY: Boolean(process.stdout.isTTY),
    columns: process.stdout.columns,
  },
  stderr: {
    write: (text) => void process.stderr.write(text),
    isTTY: Boolean(process.stderr.isTTY),
    columns: process.stderr.columns,
  },
  readStdin,
  env: process.env,
  cwd: process.cwd(),
  platform: process.platform,
  now: () => performance.now(),
};

// exitCode (not exit) lets pending output flush before the process ends.
run(process.argv.slice(2), io, pkg.version).then(
  (code) => {
    process.exitCode = code;
  },
  (error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = EXIT.failed;
  },
);
