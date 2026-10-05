/** ANSI styling without dependencies: colour depth detection and small helpers. */

/** 0 = no colour, 4 = basic 16 colours, 8 = 256 colours, 24 = true colour. */
export type ColorDepth = 0 | 4 | 8 | 24;

export type Env = Record<string, string | undefined>;

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

function terminalDepth(env: Env, platform: string): ColorDepth {
  if (env.TERM === 'dumb') return 0;
  if (
    env.COLORTERM === 'truecolor' ||
    env.COLORTERM === '24bit' ||
    env.WT_SESSION ||
    env.TERM_PROGRAM === 'vscode' ||
    env.TERM_PROGRAM === 'iTerm.app' ||
    platform === 'win32'
  ) {
    return 24;
  }
  return /256/.test(env.TERM ?? '') ? 8 : 4;
}

/**
 * Decides how many colours to use. `flag` is the --color / --no-color choice.
 * NO_COLOR disables colour, FORCE_COLOR (0–3) forces it, otherwise colour needs a terminal.
 */
export function detectColorDepth(
  env: Env,
  isTTY: boolean,
  platform: string,
  flag?: boolean,
): ColorDepth {
  if (flag === false) return 0;
  if (env.NO_COLOR) return 0;
  const force = env.FORCE_COLOR;
  const forced =
    flag === true || (force !== undefined && force !== '' && force !== '0' && force !== 'false');
  if (forced) {
    if (force === '3') return 24;
    if (force === '2') return 8;
    if (force === '1') return 4;
    return Math.max(4, terminalDepth(env, platform)) as ColorDepth;
  }
  return isTTY ? terminalDepth(env, platform) : 0;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function to256({ r, g, b }: Rgb): number {
  if (r === g && g === b)
    return r < 8 ? 16 : r > 248 ? 231 : 232 + Math.round(((r - 8) / 247) * 24);
  const c = (v: number) => Math.round(v / 51);
  return 16 + 36 * c(r) + 6 * c(g) + c(b);
}

export interface Style {
  depth: ColorDepth;
  bold(s: string): string;
  dim(s: string): string;
  underline(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  blue(s: string): string;
  magenta(s: string): string;
  cyan(s: string): string;
  gray(s: string): string;
  /** Escape sequence that sets the background to a colour, or '' when unsupported. */
  bg(rgb: Rgb): string;
  /** Escape sequence that sets the foreground to a colour, or '' when unsupported. */
  fg(rgb: Rgb): string;
  reset: string;
}

export function makeStyle(depth: ColorDepth): Style {
  const wrap = (open: number, close: number) => (s: string) =>
    depth === 0 ? s : `${ESC}[${open}m${s}${ESC}[${close}m`;
  const color = (kind: 38 | 48) => (rgb: Rgb) =>
    depth >= 24
      ? `${ESC}[${kind};2;${rgb.r};${rgb.g};${rgb.b}m`
      : depth === 8
        ? `${ESC}[${kind};5;${to256(rgb)}m`
        : '';
  return {
    depth,
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    underline: wrap(4, 24),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    blue: wrap(34, 39),
    magenta: wrap(35, 39),
    cyan: wrap(36, 39),
    gray: wrap(90, 39),
    bg: color(48),
    fg: color(38),
    reset: depth === 0 ? '' : `${ESC}[0m`,
  };
}

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

/** Length of a string as shown on screen (escape sequences take no room). */
export function visibleLength(s: string): number {
  return Array.from(stripAnsi(s)).length;
}
