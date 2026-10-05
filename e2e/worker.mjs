// Cloudflare Workers entry used by the e2e run: decodes frozen vectors and encodes a test image.
import { decode } from '../packages/core/dist/decode.js';
import { encode, encodeToString } from '../packages/core/dist/encode.js';

export default {
  async fetch(request) {
    const { vectors } = await request.json();
    let worst = 0;
    for (const v of vectors) {
      const img = decode(v.hash, { size: v.size });
      const bin = atob(v.rgba);
      for (let i = 0; i < bin.length; i++) {
        worst = Math.max(worst, Math.abs(img.data[i] - bin.charCodeAt(i)));
      }
    }
    const w = 80;
    const h = 60;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        data[o] = (x * 255) / w;
        data[o + 1] = (y * 255) / h;
        data[o + 2] = ((x >> 3) + (y >> 3)) % 2 ? 200 : 60;
        data[o + 3] = 255;
      }
    }
    const image = { data, width: w, height: h };
    return Response.json({ worst, length: encode(image).length, hash: encodeToString(image) });
  },
};
