import { linearToOklab, srgb8ToLinear } from '../../packages/core/src/encoder/color';

export interface Raw {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** Premultiplied linear RGB + alpha planes (4 floats per pixel). */
export interface LinearPremult {
  width: number;
  height: number;
  px: Float64Array;
}

/** Reference: exact area average of the source in linear light, down (or up) to w×h. */
export function referenceAt(src: Raw, w: number, h: number): LinearPremult {
  const px = new Float64Array(w * h * 4);
  const sx = src.width / w;
  const sy = src.height / h;
  for (let ty = 0; ty < h; ty++) {
    const y0 = ty * sy;
    const y1 = (ty + 1) * sy;
    for (let tx = 0; tx < w; tx++) {
      const x0 = tx * sx;
      const x1 = (tx + 1) * sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (let y = Math.floor(y0); y < Math.min(src.height, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        if (wy <= 0) continue;
        for (let x = Math.floor(x0); x < Math.min(src.width, Math.ceil(x1)); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          if (wx <= 0) continue;
          const wt = wx * wy;
          const o = (y * src.width + x) * 4;
          const A = src.data[o + 3] / 255;
          r += wt * srgb8ToLinear(src.data[o]) * A;
          g += wt * srgb8ToLinear(src.data[o + 1]) * A;
          b += wt * srgb8ToLinear(src.data[o + 2]) * A;
          a += wt * A;
          wsum += wt;
        }
      }
      const o = (ty * w + tx) * 4;
      px[o] = r / wsum;
      px[o + 1] = g / wsum;
      px[o + 2] = b / wsum;
      px[o + 3] = a / wsum;
    }
  }
  return { width: w, height: h, px };
}

/** Decoded 8-bit sRGB RGBA (straight alpha) to premultiplied linear. */
export function toLinearPremult(img: Raw): LinearPremult {
  const n = img.width * img.height;
  const px = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const A = img.data[i * 4 + 3] / 255;
    px[i * 4] = srgb8ToLinear(img.data[i * 4]) * A;
    px[i * 4 + 1] = srgb8ToLinear(img.data[i * 4 + 1]) * A;
    px[i * 4 + 2] = srgb8ToLinear(img.data[i * 4 + 2]) * A;
    px[i * 4 + 3] = A;
  }
  return { width: img.width, height: img.height, px };
}

function labOver(img: LinearPremult, bg: number): Float64Array {
  const n = img.width * img.height;
  const out = new Float64Array(n * 3);
  const lab = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const k = (1 - img.px[i * 4 + 3]) * bg;
    linearToOklab(
      Math.max(0, img.px[i * 4] + k),
      Math.max(0, img.px[i * 4 + 1] + k),
      Math.max(0, img.px[i * 4 + 2] + k),
      lab,
    );
    out[i * 3] = lab[0];
    out[i * 3 + 1] = lab[1];
    out[i * 3 + 2] = lab[2];
  }
  return out;
}

function ssimL(a: Float64Array, b: Float64Array, w: number, h: number): number {
  const win = 7;
  const ww = Math.min(win, w);
  const wh = Math.min(win, h);
  const C1 = 0.01 * 0.01;
  const C2 = 0.03 * 0.03;
  let total = 0;
  let count = 0;
  const N = ww * wh;
  for (let y = 0; y + wh <= h; y++) {
    for (let x = 0; x + ww <= w; x++) {
      let ma = 0;
      let mb = 0;
      for (let j = 0; j < wh; j++) {
        for (let i = 0; i < ww; i++) {
          const p = ((y + j) * w + x + i) * 3;
          ma += a[p];
          mb += b[p];
        }
      }
      ma /= N;
      mb /= N;
      let va = 0;
      let vb = 0;
      let cov = 0;
      for (let j = 0; j < wh; j++) {
        for (let i = 0; i < ww; i++) {
          const p = ((y + j) * w + x + i) * 3;
          const da = a[p] - ma;
          const db = b[p] - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
      }
      va /= N;
      vb /= N;
      cov /= N;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count++;
    }
  }
  return total / count;
}

export interface Score {
  dE: number;
  dE95: number;
  ssim: number;
}

/** ΔE_OK (x100) mean and 95th percentile plus SSIM on L; alpha images are scored over white and black. */
export function score(ref: LinearPremult, test: LinearPremult): Score {
  let hasAlpha = false;
  for (let i = 3; i < ref.px.length; i += 4) {
    if (ref.px[i] < 0.999) {
      hasAlpha = true;
      break;
    }
  }
  const bgs = hasAlpha ? [1, 0] : [1];
  let dE = 0;
  let dE95 = 0;
  let ssim = 0;
  const n = ref.width * ref.height;
  for (const bg of bgs) {
    const a = labOver(ref, bg);
    const b = labOver(test, bg);
    const d = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      d[i] =
        100 *
        Math.hypot(a[i * 3] - b[i * 3], a[i * 3 + 1] - b[i * 3 + 1], a[i * 3 + 2] - b[i * 3 + 2]);
      sum += d[i];
    }
    d.sort();
    dE += sum / n;
    dE95 += d[Math.min(n - 1, Math.floor(0.95 * n))];
    ssim += ssimL(a, b, ref.width, ref.height);
  }
  return { dE: dE / bgs.length, dE95: dE95 / bgs.length, ssim: ssim / bgs.length };
}
