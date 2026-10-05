import { stripAnsi, visibleLength, type Rgb, type Style } from './style';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function toHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function truncateMiddle(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  if (max <= 1) return '…';
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return chars.slice(0, head).join('') + '…' + (tail > 0 ? chars.slice(-tail).join('') : '');
}

export function padEnd(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - visibleLength(s)));
}

export function padStart(s: string, width: number): string {
  return ' '.repeat(Math.max(0, width - visibleLength(s))) + s;
}

/** A two-character colour block, or nothing when the terminal has no colour. */
export function swatch(style: Style, rgb: Rgb): string {
  const open = style.bg(rgb);
  return open ? `${open}  ${style.reset}` : '';
}

/** Splits free text into lines no wider than `width`, keeping words whole. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of stripAnsi(text).split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
