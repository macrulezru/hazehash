/** A small argument parser: long and short options, `--name=value`, `--no-name`, grouped flags. */

export class UsageError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'UsageError';
    this.hint = hint;
  }
}

export interface OptionSpec {
  /** Long name without dashes, e.g. 'budget'. */
  long: string;
  short?: string;
  /** `flag` takes no value, `value` takes one. */
  kind: 'flag' | 'value';
  /** Also accept `--no-<long>` (flags only). */
  negatable?: boolean;
}

export interface Parsed {
  positionals: string[];
  /** Flags that were given; a negated flag appears as `no-<long>`. */
  flags: Set<string>;
  values: Map<string, string>;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

function suggest(name: string, specs: OptionSpec[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const spec of specs) {
    const d = distance(name, spec.long);
    if (d < bestDistance) {
      best = spec.long;
      bestDistance = d;
    }
  }
  return best ? `Did you mean --${best}?` : undefined;
}

export function parseArgs(argv: string[], specs: OptionSpec[]): Parsed {
  const parsed: Parsed = { positionals: [], flags: new Set(), values: new Map() };
  const byLong = new Map(specs.map((s) => [s.long, s]));
  const byShort = new Map(specs.filter((s) => s.short).map((s) => [s.short as string, s]));

  const setValue = (spec: OptionSpec, shown: string, value: string | undefined) => {
    if (value === undefined) throw new UsageError(`Option ${shown} needs a value`);
    parsed.values.set(spec.long, value);
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      parsed.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = arg.slice(2, eq < 0 ? undefined : eq);
      const inline = eq < 0 ? undefined : arg.slice(eq + 1);
      const negated = name.startsWith('no-') && byLong.get(name.slice(3))?.negatable;
      const spec = byLong.get(negated ? name.slice(3) : name);
      if (!spec) throw new UsageError(`Unknown option --${name}`, suggest(name, specs));
      if (spec.kind === 'flag') {
        if (inline !== undefined) throw new UsageError(`Option --${name} does not take a value`);
        parsed.flags.add(negated ? `no-${spec.long}` : spec.long);
      } else {
        setValue(spec, `--${name}`, inline ?? argv[++i]);
      }
    } else if (arg.length > 1 && arg.startsWith('-')) {
      // One or more short options: -r, -rq, -b 24, -b24
      for (let k = 1; k < arg.length; k++) {
        const spec = byShort.get(arg[k]);
        if (!spec) throw new UsageError(`Unknown option -${arg[k]}`);
        if (spec.kind === 'flag') {
          parsed.flags.add(spec.long);
        } else {
          const rest = arg.slice(k + 1).replace(/^=/, '');
          setValue(spec, `-${arg[k]}`, rest || argv[++i]);
          break;
        }
      }
    } else {
      parsed.positionals.push(arg);
    }
  }
  return parsed;
}

/** Reads an integer option, checking its range. */
export function intOption(
  parsed: Parsed,
  long: string,
  range: { min: number; max: number },
): number | undefined {
  const raw = parsed.values.get(long);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!/^-?\d+$/.test(raw) || n < range.min || n > range.max) {
    throw new UsageError(
      `--${long} must be a whole number from ${range.min} to ${range.max}, got "${raw}"`,
    );
  }
  return n;
}

/** Reads an option that must be one of a fixed set of words. */
export function enumOption<T extends string>(
  parsed: Parsed,
  long: string,
  allowed: readonly T[],
): T | undefined {
  const raw = parsed.values.get(long);
  if (raw === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new UsageError(`--${long} must be one of: ${allowed.join(', ')} (got "${raw}")`);
  }
  return raw as T;
}
