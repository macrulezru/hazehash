import { parseArgs, UsageError, type OptionSpec, type Parsed } from './args';
import { decodeCommand, DECODE_OPTIONS } from './commands/decode';
import { encodeCommand, ENCODE_OPTIONS, type Context } from './commands/encode';
import { infoCommand, INFO_OPTIONS } from './commands/info';
import { decodeHelp, encodeHelp, infoHelp, mainHelp } from './help';
import { EXIT, type Io } from './io';
import { detectColorDepth, makeStyle } from './style';

const GLOBAL_OPTIONS: OptionSpec[] = [
  { long: 'help', short: 'h', kind: 'flag' },
  { long: 'version', short: 'V', kind: 'flag' },
  { long: 'color', kind: 'flag', negatable: true },
];

type Command = {
  options: OptionSpec[];
  help: (s: ReturnType<typeof makeStyle>, version: string) => string;
  run: (parsed: Parsed, ctx: Context) => Promise<number>;
};

const COMMANDS: Record<string, Command> = {
  encode: { options: ENCODE_OPTIONS, help: encodeHelp, run: encodeCommand },
  decode: { options: DECODE_OPTIONS, help: decodeHelp, run: decodeCommand },
  info: { options: INFO_OPTIONS, help: infoHelp, run: infoCommand },
};

/** `--color` / `--no-color` anywhere on the line, so errors in parsing can be coloured too. */
function colorFlag(argv: string[]): boolean | undefined {
  const end = argv.indexOf('--');
  const list = end < 0 ? argv : argv.slice(0, end);
  if (list.includes('--no-color')) return false;
  if (list.includes('--color')) return true;
  return undefined;
}

/**
 * Runs the command line and returns the exit code: 0 success, 1 something failed, 2 a mistake
 * in the command line. All output goes through `io`, which makes the CLI testable.
 */
export async function run(argv: string[], io: Io, version: string): Promise<number> {
  const flag = colorFlag(argv);
  const out = makeStyle(detectColorDepth(io.env, io.stdout.isTTY, io.platform, flag));
  const err = makeStyle(detectColorDepth(io.env, io.stderr.isTTY, io.platform, flag));
  const ctx: Context = { io, out, err, version };

  try {
    // The command is the first word that is not a global flag.
    let index = 0;
    while (
      index < argv.length &&
      /^(-h|--help|-V|--version|--color|--no-color)$/.test(argv[index])
    ) {
      index++;
    }
    const lead = argv.slice(0, index);
    const name = argv[index];

    if (lead.includes('--version') || lead.includes('-V')) {
      io.stdout.write(`${version}\n`);
      return EXIT.ok;
    }
    if (lead.includes('--help') || lead.includes('-h') || name === undefined || name === 'help') {
      const topic = name === 'help' ? argv[index + 1] : undefined;
      const command = topic ? COMMANDS[topic] : undefined;
      if (topic && !command)
        throw new UsageError(`Unknown command "${topic}"`, 'Commands: encode, decode, info');
      io.stdout.write(command ? command.help(out, version) : mainHelp(out, version));
      return EXIT.ok;
    }

    const command = COMMANDS[name];
    if (!command) {
      throw new UsageError(
        `Unknown command "${name}"`,
        'Commands: encode, decode, info. Run hazehash --help for details.',
      );
    }
    const parsed = parseArgs(argv.slice(index + 1), [...command.options, ...GLOBAL_OPTIONS]);
    if (parsed.flags.has('help')) {
      io.stdout.write(command.help(out, version));
      return EXIT.ok;
    }
    if (parsed.flags.has('version')) {
      io.stdout.write(`${version}\n`);
      return EXIT.ok;
    }
    return await command.run(parsed, ctx);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`${err.red('✖')} ${err.bold(error.message)}\n`);
      if (error.hint) io.stderr.write(`  ${err.dim(error.hint)}\n`);
      io.stderr.write(`  ${err.dim('See hazehash --help')}\n`);
      return EXIT.usage;
    }
    io.stderr.write(`${err.red('✖')} ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.failed;
  }
}
