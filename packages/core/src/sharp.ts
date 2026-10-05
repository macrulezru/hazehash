import { PlaceholderError } from './errors';

/**
 * Minimal view of the optional `sharp` dependency. Its real types are not needed here and
 * `sharp` is not a dependency of this package, so the chain is loosely typed on purpose.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SharpFn = (input?: any, options?: any) => any;

export const SHARP_MISSING = 'the optional dependency "sharp" is required to read image files';

/** Loads `sharp`, or throws a PlaceholderError that explains how to install it. */
export async function loadSharp(): Promise<SharpFn> {
  try {
    const mod = (await import('sharp')) as unknown as { default?: SharpFn } & SharpFn;
    return (mod.default ?? mod) as SharpFn;
  } catch {
    throw new PlaceholderError('InvalidInput', `${SHARP_MISSING} (npm i sharp)`);
  }
}
