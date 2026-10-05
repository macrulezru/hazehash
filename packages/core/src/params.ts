/**
 * Format constants that are tuned by benchmark. Internal: the decoder and the encoder must see
 * identical values, so this object is only mutated by the tuning harness, never by library users.
 */
export interface Params {
  /** Positive quantization levels for luma and for chroma and alpha. */
  qmaxL: number;
  qmaxC: number;
  /** Maximum AC amplitude of the scale code 15 for L/A and for a/b. */
  smaxL: number;
  smaxC: number;
  /** Reconstruction offset in levels: |q| is decoded as |q| - offset. */
  reconOffset: number;
  /** Grid aspect tolerances (ratio) for luma and for chroma/alpha. */
  tolLuma: number;
  tolChroma: number;
}

export const DEFAULT_PARAMS: Readonly<Params> = {
  qmaxL: 7,
  qmaxC: 3,
  smaxL: 0.64,
  smaxC: 0.32,
  reconOffset: 0,
  tolLuma: 5,
  tolChroma: 6,
};

export const PARAMS: Params = { ...DEFAULT_PARAMS };
