export interface RgbaImage {
  /** RGBA, straight (non-premultiplied) alpha, length 4·width·height. */
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface EncodeOptions {
  /** Maximum result size in bytes, header included. Default 28. */
  budget?: number;
  /** Long side of the analysis grid, 32–128. Default 64. */
  analysisSize?: number;
  /** 'auto': alpha is stored when the minimum A is below 254/255. */
  alpha?: 'auto' | boolean;
  /** Channel weights in the error metric, default 1, 1, 1. */
  weights?: { L?: number; C?: number; A?: number };
  profile?: 'fast' | 'default' | 'high';
}

export interface DecodeOptions {
  /** Long side of the output, default 32 (allowed 4–128). */
  size?: number;
  /** Deterministic dithering, default true. */
  dither?: boolean;
}
