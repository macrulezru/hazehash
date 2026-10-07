# **HazeHash**

![HazeHash](https://github.com/macrulezru/assets/blob/master/packages-images/hazehash-vuecraft.webp?raw=true)

Compact image placeholders: a short string in place of an image that rebuilds a blurred preview
with the right aspect ratio and, when needed, transparency in a fraction of a millisecond. The
encoder, the decoder, a canvas helper, Node.js file helpers and the `hazehash` command, with no
runtime dependencies.

Part of the [hazehash](https://github.com/macrulezru/hazehash) monorepo. Vue and Nuxt wrappers:
[`hazehash-vue`](https://www.npmjs.com/package/hazehash-vue),
[`hazehash-nuxt`](https://www.npmjs.com/package/hazehash-nuxt).

---

## Features

- **Lower perceptual error at the same size** — at 28 bytes the mean error is 49% lower than BlurHash and 20% lower than ThumbHash, measured on 513 photos, screenshots and graphics
- **A byte budget instead of a grid size** — `budget` is the maximum size of a hash in bytes (16 for the smallest practical hash, 28 by default, 36 and more for detail); simple images come out smaller than the budget
- **Aspect ratio and transparency inside the string** — the header stores the ratio, and an alpha block is added only when the image has transparent pixels
- **A better colour model** — OKLab colour, an orthogonal DCT basis, separate luma and chroma grids, rate-distortion optimised quantisation and Golomb–Rice coding
- **No runtime dependencies** — the core never touches the DOM, `window` or `Buffer`, so it runs in browsers, Node.js 20+, Cloudflare Workers and other runtimes; reading image files uses the optional peer `sharp`
- **Deterministic and unchanging** — the same input and options always give the same bytes, and the version 1 format will not change: a hash stored today decodes the same way in every future release
- **Tree-shakable entry points** — the decoder is about 2.6 KB gzip, the encoder about 6.3 KB, and the canvas helper adds about 0.05 KB; the decoder never pulls in the encoder
- **Tolerant of truncation** — a cut hash is still valid and decodes with less detail, and a malformed one never hangs or crashes the decoder: it either decodes or throws a `PlaceholderError`
- **A command line** — `hazehash encode`, `decode` and `info` hash files, folders and globs, draw a preview in the terminal and explain what a string contains

---

## When you'd reach for this

You want a placeholder for an image without shipping the image, or the heavy library around it: the hash is a few dozen bytes, the decoder a few kilobytes.

- **Hashes stored with your data** — Compute the hash once when an image is uploaded and keep it in a column next to the record: 28 bytes as binary, about 40 characters as text. Decoding the hash into a preview happens on the client.
- **A page that must not jump while images load** — The hash carries the aspect ratio and the average colour, so a box has its shape and colour at once, and the blurred frame is drawn when the script runs.
- **A build step that hashes a folder of images** — The Node.js helpers and the `hazehash` command turn a folder into a JSON file of hashes in one go.
- **A runtime without a DOM** — The encoder and decoder run in a worker, on a server or in an edge runtime, because they use only typed arrays.

---

## Installation

```bash
npm install hazehash
```

Requires Node.js `20+`. In the browser nothing else is needed. Reading image files (the Node.js helpers and the command line) needs the optional peer `sharp` `>=0.33`:

```bash
npm install --save-dev sharp
```

### Quick start

```ts
import { encodeToString } from 'hazehash/encode';
import { decode, getAverageColor } from 'hazehash';

// Encode: any RGBA pixel buffer (straight alpha, sRGB).
const hash = encodeToString({ data: rgba, width, height }); // e.g. "Ed7UwRWKKv5znm6a7sC1tziHDNpMuCikxrYpIg"

// Decode: a small RGBA preview, 32 px on the long side by default.
const { width: w, height: h, data } = decode(hash);

// Header-only helpers, cheap enough to run on every render.
const { r, g, b, a } = getAverageColor(hash); // a is 0–1
```

Encode on the server or at build time and ship only the hash; decode in the browser. Files on disk go through the Node.js helper:

```ts
import { encodeFileToString } from 'hazehash/node'; // needs sharp

const hash = await encodeFileToString('photo.jpg', { budget: 24 });
```

or through the [command line](#command-line): `npx hazehash encode photo.jpg --budget 24`.

Draw into a canvas:

```ts
import { drawToCanvas } from 'hazehash/canvas';

drawToCanvas(hash, document.querySelector('canvas')!);
```

### More examples

#### Entry points

| Import            | Contents                                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| `hazehash`        | `decode`, `getAspectRatio`, `getAverageColor`, `toBytes`, errors                       |
| `hazehash/decode` | same as above                                                                          |
| `hazehash/encode` | `encode`, `encodeToString`, `toBase64Url`, errors                                      |
| `hazehash/canvas` | `drawToCanvas(hash, canvas, options)`, `toImageData(hash, options)`                    |
| `hazehash/node`   | `encodeFile`, `encodeFileToString`, `encodeFileDetailed` (needs optional peer `sharp`) |

#### API

```ts
encode(image: RgbaImage, options?: EncodeOptions): Uint8Array
encodeToString(image: RgbaImage, options?: EncodeOptions): string
decode(hash: string | Uint8Array, options?: DecodeOptions): RgbaImage
getAspectRatio(hash): number
getAverageColor(hash): { r: number; g: number; b: number; a: number }
toBytes(base64url: string): Uint8Array
toBase64Url(bytes: Uint8Array): string
```

`RgbaImage` is `{ data: Uint8Array | Uint8ClampedArray; width: number; height: number }` with straight (non-premultiplied) sRGB RGBA. `ImageData` from a canvas fits as is.

#### Encoder options

| Option         | Default                | Meaning                                                       |
| -------------- | ---------------------- | ------------------------------------------------------------- |
| `budget`       | `28`                   | maximum bytes, header included (7, or 9 with alpha, at least) |
| `analysisSize` | `64`                   | long side of the analysis grid (32–128)                       |
| `alpha`        | `'auto'`               | store alpha when the minimum alpha is below 254/255           |
| `weights`      | `{ L: 1, C: 1, A: 1 }` | channel weights in the error metric                           |
| `profile`      | `'default'`            | `'fast'`, `'default'` or `'high'`                             |

Profiles trade time for quality: `fast` searches fewer grids (about 1 ms), `default` searches all of them (about 5 ms; inputs with alpha are slower, around 100 ms), `high` additionally refines the coefficients against the analysis image (about 1% lower error, about 14 ms). Timings are for a 64×48 input and grow with the input size only through the area-average downscale.

#### Decoder options

| Option   | Default | Meaning                                               |
| -------- | ------- | ----------------------------------------------------- |
| `size`   | `32`    | long side of the output, 4–128                        |
| `dither` | `true`  | deterministic dithering; `false` gives plain rounding |

#### Choosing a budget

| Budget | Base64url characters | Mean ΔE (OKLab ×100) | Comment                           |
| ------ | -------------------- | -------------------- | --------------------------------- |
| 16     | 22                   | 8.41                 | smallest practical hash           |
| 20     | 27                   | 7.89                 | still beats ThumbHash by 14%      |
| 24     | 32                   | 7.54                 | good size/quality compromise      |
| 28     | 38                   | 7.29                 | default                           |
| 36     | 48                   | 7.00                 | more detail when size is no issue |

The benchmark set has 513 photos, screenshots and graphics; lower ΔE is better. Hashes can be stored as text (`VARCHAR`) or as raw bytes (`BYTEA`/`BLOB`, about 25% shorter).

#### Errors

All failures are `PlaceholderError` with a `code`: `InvalidInput`, `BudgetTooSmall` (encoder), `InvalidLength`, `InvalidCharacter`, `UnsupportedVersion` (decoder). A malformed hash never hangs or crashes the decoder: it either decodes or throws one of these.

#### Command line

The package installs a `hazehash` command (it needs the optional package `sharp` to read images):

```bash
npm install --save-dev hazehash sharp
npx hazehash --help
```

| Command                  | What it does                                                               |
| ------------------------ | -------------------------------------------------------------------------- |
| `hazehash encode <in…>`  | Hashes of image files, folders, globs (`"photos/**/*.jpg"`) or stdin (`-`) |
| `hazehash decode <hash>` | Draws the preview in the terminal, or saves it with `-o preview.png`       |
| `hazehash info <hash>`   | Explains what a hash contains: size, aspect ratio, grids, average colour   |

```bash
hazehash encode photo.jpg                        # prints just the hash, handy in scripts
hazehash encode ./images -r --budget 24          # a coloured table for a folder
hazehash encode "images/**/*.jpg" -f json -o hashes.json
cat photo.jpg | hazehash encode -
hazehash decode Ef90QP3dAP7_773v3y-6uqjYQIqBEaRAVVEpEA
```

Main options of `encode`: `-b, --budget` (bytes, default 28), `-p, --profile` (`fast`/`default`/`high`), `--alpha`, `-r, --recursive`, `-f, --format text|json|csv`, `--details` (sizes in json/csv), `--hex`, `-o, --output`, `-q, --quiet`. Every command has `--help` with the full list and explanations.

- In a terminal the result is a coloured table with image and hash sizes, the average colour and a summary; when the output is piped it is plain text, so scripts can use it directly.
- Colours follow `NO_COLOR`, `FORCE_COLOR`, `--color` and `--no-color`.
- Exit codes: `0` success, `1` at least one image failed (the others are still written), `2` a mistake in the command line.

The same encoder is available from code as `encodeFileDetailed(pathOrBuffer, options)`, which also returns the image size.

#### Notes

- Input is assumed to be sRGB; the core ignores ICC profiles and EXIF orientation. The Node.js helper and the command line convert to sRGB and apply the EXIF orientation through `sharp`.
- Animated images: pass a single frame.
- A truncated hash is still valid and decodes with less detail.
- The version 1 format will not change: a hash decodes the same way in every release.

---

## Documentation & links

- 📖 **Full documentation:** [npm.vuecraft.ru/en/packages/hazehash](https://npm.vuecraft.ru/en/packages/hazehash/guide/overview.html)
- 🌐 **VueCraft:** [vuecraft.ru/en](https://vuecraft.ru/en)
- 👤 **Author:** [macrulez.ru/en](https://macrulez.ru/en)
- 💻 **GitHub:** [macrulezru/hazehash](https://github.com/macrulezru/hazehash)
- 📦 **NPM:** [hazehash](https://www.npmjs.com/package/hazehash)
- 🐛 **Issues:** [github.com/macrulezru/hazehash/issues](https://github.com/macrulezru/hazehash/issues)

---

## License

MIT

---

## 💖 Support the project

Open source takes time and effort. If this library saves you time or brings value, consider supporting further development.

<a href="https://donate.cryptocloud.plus/M6O34NIN" target="_blank">
  <img src="https://img.shields.io/badge/Donate-CryptoCloud-8A2BE2?style=for-the-badge&logo=cryptocurrency&logoColor=white" alt="Donate via CryptoCloud">
</a>

Thank you for being part of this journey. ❤️
