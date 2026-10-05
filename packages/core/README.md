# hazehash

Compact image placeholders: an image becomes a 16–48 byte string (28 by default, 38 base64url
characters) from which a blurred preview is rebuilt in a fraction of a millisecond. The string also
carries the aspect ratio and, when needed, the alpha channel.

- Lower perceptual error than BlurHash and ThumbHash at the same size.
- OKLab colour, orthogonal DCT basis, separate luma and chroma grids, rate-distortion optimised
  quantisation, Golomb–Rice coding.
- No runtime dependencies. The core never touches the DOM, `window` or `Buffer`, so it runs in
  browsers, Node.js 20+, Cloudflare Workers and other runtimes.
- Deterministic: the same input and options always give the same bytes.

```sh
npm install hazehash
```

## Quick start

```ts
import { encodeToString } from 'hazehash/encode';
import { decode, getAverageColor } from 'hazehash';

// Encode: any RGBA pixel buffer (straight alpha, sRGB).
const hash = encodeToString({ data: rgba, width, height }); // e.g. "Ebs0QP3dKv73c2scoqwFUA"

// Decode: a small RGBA preview, 32 px on the long side by default.
const { width: w, height: h, data } = decode(hash);

// Header-only helpers, cheap enough to run on every render.
const { r, g, b, a } = getAverageColor(hash); // a is 0–1
```

Encode on the server or at build time and ship only the hash; decode in the browser. Files on disk
go through the Node helper:

```ts
import { encodeFileToString } from 'hazehash/node'; // needs: npm i sharp

const hash = await encodeFileToString('photo.jpg', { budget: 24 });
```

or the [command line](#command-line): `npx hazehash encode photo.jpg --budget 24`.

Draw into a canvas:

```ts
import { drawToCanvas } from 'hazehash/canvas';

drawToCanvas(hash, document.querySelector('canvas')!);
```

## Entry points

| Import            | Contents                                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| `hazehash`        | `decode`, `getAspectRatio`, `getAverageColor`, `toBytes`, errors                       |
| `hazehash/decode` | same as above                                                                          |
| `hazehash/encode` | `encode`, `encodeToString`, `toBase64Url`, errors                                      |
| `hazehash/canvas` | `drawToCanvas(hash, canvas, options)`, `toImageData(hash, options)`                    |
| `hazehash/node`   | `encodeFile`, `encodeFileToString`, `encodeFileDetailed` (needs optional peer `sharp`) |

The decoder entry points do not pull in the encoder, so browsers only download what they use.

## API

```ts
encode(image: RgbaImage, options?: EncodeOptions): Uint8Array
encodeToString(image: RgbaImage, options?: EncodeOptions): string
decode(hash: string | Uint8Array, options?: DecodeOptions): RgbaImage
getAspectRatio(hash): number
getAverageColor(hash): { r: number; g: number; b: number; a: number }
toBytes(base64url: string): Uint8Array
toBase64Url(bytes: Uint8Array): string
```

`RgbaImage` is `{ data: Uint8Array | Uint8ClampedArray; width: number; height: number }` with
straight (non-premultiplied) sRGB RGBA. `ImageData` from a canvas fits as is.

### Encoder options

| Option         | Default                | Meaning                                                       |
| -------------- | ---------------------- | ------------------------------------------------------------- |
| `budget`       | `28`                   | maximum bytes, header included (7, or 9 with alpha, at least) |
| `analysisSize` | `64`                   | long side of the analysis grid (32–128)                       |
| `alpha`        | `'auto'`               | store alpha when the minimum alpha is below 254/255           |
| `weights`      | `{ L: 1, C: 1, A: 1 }` | channel weights in the error metric                           |
| `profile`      | `'default'`            | `'fast'`, `'default'` or `'high'`                             |

Profiles trade time for quality: `fast` searches fewer grids (about 1 ms), `default` searches all
of them (about 5 ms; inputs with alpha are slower, around 100 ms), `high` additionally refines the coefficients against the analysis image
(about 1% lower error, a few ms more). Timings are for a 64×48 input and grow with the input size
only through the area-average downscale.

### Decoder options

| Option   | Default | Meaning                                               |
| -------- | ------- | ----------------------------------------------------- |
| `size`   | `32`    | long side of the output, 4–128                        |
| `dither` | `true`  | deterministic dithering; `false` gives plain rounding |

## Choosing a budget

| Budget | Base64url characters | Mean ΔE (OKLab ×100) | Comment                           |
| ------ | -------------------- | -------------------- | --------------------------------- |
| 16     | 22                   | 8.41                 | smallest practical hash           |
| 20     | 27                   | 7.89                 | still beats ThumbHash by 14%      |
| 24     | 32                   | 7.54                 | good size/quality compromise      |
| 28     | 38                   | 7.29                 | default                           |
| 36     | 48                   | 7.00                 | more detail when size is no issue |

The benchmark set has 513 photos, screenshots and graphics; lower ΔE is better. Hashes can be
stored as text (`VARCHAR`) or as raw bytes (`BYTEA`/`BLOB`, about 25% shorter).

## Errors

All failures are `PlaceholderError` with a `code`: `InvalidInput`, `BudgetTooSmall` (encoder),
`InvalidLength`, `InvalidCharacter`, `UnsupportedVersion` (decoder). A malformed hash never hangs
or crashes the decoder: it either decodes or throws one of these.

## Command line

The package installs a `hazehash` command (it needs the optional package `sharp` to read images):

```sh
npm install --save-dev hazehash sharp
npx hazehash --help
```

| Command                  | What it does                                                               |
| ------------------------ | -------------------------------------------------------------------------- |
| `hazehash encode <in…>`  | Hashes of image files, folders, globs (`"photos/**/*.jpg"`) or stdin (`-`) |
| `hazehash decode <hash>` | Draws the preview in the terminal, or saves it with `-o preview.png`       |
| `hazehash info <hash>`   | Explains what a hash contains: size, aspect ratio, grids, average colour   |

```sh
hazehash encode photo.jpg                        # prints just the hash, handy in scripts
hazehash encode ./images -r --budget 24          # a coloured table for a folder
hazehash encode "images/**/*.jpg" -f json -o hashes.json
cat photo.jpg | hazehash encode -
hazehash decode Ef90QP3dAP7_773v3y-6uqjYQIqBEaRAVVEpEA
```

Main options of `encode`: `-b, --budget` (bytes, default 28), `-p, --profile`
(`fast`/`default`/`high`), `--alpha`, `-r, --recursive`, `-f, --format text|json|csv`,
`--details` (sizes in json/csv), `--hex`, `-o, --output`, `-q, --quiet`. Every command has
`--help` with the full list and explanations.

- In a terminal the result is a coloured table with image and hash sizes, the average colour and a
  summary; when the output is piped it is plain text, so scripts can use it directly.
- Colours follow `NO_COLOR`, `FORCE_COLOR`, `--color` and `--no-color`.
- Exit codes: `0` success, `1` at least one image failed (the others are still written), `2` a mistake
  in the command line.

The same encoder is available from code as `encodeFileDetailed(pathOrBuffer, options)`, which also
returns the image size.

## Notes

- Input is assumed to be sRGB; the core ignores ICC profiles and EXIF orientation. The Node helper
  and the command line convert to sRGB and apply the EXIF orientation through `sharp`.
- Animated images: pass a single frame.
- A truncated hash is still valid and decodes with less detail.
- Version 1 decoding is frozen: a hash decodes the same way in every release.
