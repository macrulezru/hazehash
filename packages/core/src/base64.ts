import { PlaceholderError } from './errors';

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const REVERSE = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) REVERSE[ALPHABET.charCodeAt(i)] = i;

export function toBytes(hash: string): Uint8Array {
  const len = hash.length;
  if (len % 4 === 1) throw new PlaceholderError('InvalidLength');
  const out = new Uint8Array(Math.floor((len * 6) / 8));
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < len; i++) {
    const code = hash.charCodeAt(i);
    const v = code < 128 ? REVERSE[code] : -1;
    if (v < 0) throw new PlaceholderError('InvalidCharacter');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (acc >> bits) & 255;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

export function asBytes(hash: string | Uint8Array): Uint8Array {
  return typeof hash === 'string' ? toBytes(hash) : hash;
}
