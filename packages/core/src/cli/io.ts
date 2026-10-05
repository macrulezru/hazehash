import type { Env } from './style';

export interface OutStream {
  write(text: string): void;
  isTTY: boolean;
  /** Width of the terminal in columns, when known. */
  columns?: number;
}

/** Everything the CLI needs from its surroundings, so tests can run it without a terminal. */
export interface Io {
  stdout: OutStream;
  stderr: OutStream;
  /** Reads all of standard input. */
  readStdin(): Promise<Uint8Array>;
  env: Env;
  cwd: string;
  platform: string;
  now(): number;
}

/** Process exit codes. */
export const EXIT = { ok: 0, failed: 1, usage: 2 } as const;
