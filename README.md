# **HazeHash**

![HazeHash](https://github.com/macrulezru/assets/blob/master/packages-images/hazehash-vuecraft.webp?raw=true)

Compact image placeholders: a short string in place of an image that rebuilds a blurred preview
with the right aspect ratio and, when needed, transparency in a fraction of a millisecond. At the
same size it has about 49% lower perceptual error than BlurHash and 20% lower than ThumbHash. You
store the string next to your data, and the browser draws the preview from it before the image
arrives.

---

## Packages

| Package                          | Description                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`hazehash`](packages/core)      | Encoder, decoder, canvas and Node.js helpers, and the `hazehash` command. No runtime dependencies.                   |
| [`hazehash-vue`](packages/vue)   | `<PlaceholderImage>` component and `usePlaceholder()` composable for Vue 3, with server markup that cannot mismatch. |
| [`hazehash-nuxt`](packages/nuxt) | Nuxt module: registers the component and generates the hashes of your images during the build.                       |

---

## Features

- **Lower perceptual error at the same size** — at 28 bytes the mean error is 49% lower than BlurHash and 20% lower than ThumbHash, measured on 513 photos, screenshots and graphics
- **A byte budget instead of a grid size** — `budget` is the maximum size of a hash in bytes (16 for the smallest practical hash, 28 by default, 36 and more for detail), and the encoder spends it where the image needs it; simple images come out smaller than the budget
- **Aspect ratio and transparency inside the string** — the header stores the ratio, so the box can be sized before the image loads, and an alpha block is added only when the image has transparent pixels
- **A better colour model** — OKLab colour, an orthogonal DCT basis, separate luma and chroma grids, rate-distortion optimised quantisation and Golomb–Rice coding
- **No runtime dependencies** — the core never touches the DOM, `window` or `Buffer`, so it runs in browsers, Node.js 20+, Cloudflare Workers and other runtimes; reading image files in Node.js uses the optional peer `sharp`
- **Deterministic and unchanging** — the same input and options always give the same bytes, and the version 1 format will not change: a hash stored today decodes the same way in every future release
- **Tree-shakable entry points** — the decoder is about 2.6 KB gzip, the encoder about 6.3 KB, and the canvas helper adds about 0.05 KB, so a browser downloads only what it imports
- **Tolerant of truncation** — a cut hash is still valid and decodes with less detail, and a malformed one never hangs or crashes the decoder: it either decodes or throws a `PlaceholderError`
- **Vue 3 component and Nuxt module** — `<PlaceholderImage>` renders only the average colour and the aspect ratio on the server, so hydration cannot mismatch, and the Nuxt module generates the hashes of your images during the build
- **A command line** — `hazehash encode`, `decode` and `info` hash files, folders and globs, draw a preview in the terminal and explain what a string contains

---

## When you'd reach for this

While an image loads, the visitor sees an empty frame and the page around it jumps. HazeHash turns an image into a short string that is easy to keep next to your data, and draws a blurred preview of the right shape and colour from it.

- **A catalogue of hundreds of product cards** — Instead of grey rectangles while the photos load, the API returns a short 38-character string for every image, and each card shows a blurred frame of the right proportions at once, with no layout jump.
- **Hashes in a database or a CMS** — The hash is computed once when the image is uploaded and stored in a column next to the record: 28 bytes as binary, about 40 characters as text. Decoding the hash into a preview happens on the client, and the image itself does not have to be downloaded for it.
- **A server-rendered page** — The server sends only the average colour and the aspect ratio, and the blurred frame is drawn in the browser, so the markup before and after hydration is identical and there is no mismatch warning.
- **A folder of images in the repository** — Hashes for every file in a folder are collected during the site build and cached by file size and modification time. Unchanged images are not encoded again, and a one-off job needs only a terminal command.

---

## Installation

| Requirement                | Needed                                                         |
| -------------------------- | -------------------------------------------------------------- |
| Node.js `20+`              | always                                                         |
| Vue `^3.3.0`               | only for `hazehash-vue`                                        |
| Nuxt `^3.9.0`              | only for `hazehash-nuxt`                                       |
| `sharp` `>=0.33`, optional | reading image files: Node.js helpers, the command, Nuxt hashes |

```bash
npm install hazehash                     # encoder, decoder, helpers, the command
npm install hazehash hazehash-vue        # Vue 3
npm install hazehash-nuxt                # Nuxt (pulls in hazehash and hazehash-vue)
npm install --save-dev sharp             # only where image files have to be read
```

### Quick start — Core

Encode an image once, on the server or at build time, and keep only the string:

```ts
import { encodeToString } from 'hazehash/encode';
import { decode, getAverageColor } from 'hazehash';

// rgba: straight (non-premultiplied) sRGB pixels, 4 bytes per pixel
const hash = encodeToString({ data: rgba, width, height });
// "Ed7UwRWKKv5znm6a7sC1tziHDNpMuCikxrYpIg"

const { width: w, height: h, data } = decode(hash); // RGBA, 32 px on the long side
const { r, g, b, a } = getAverageColor(hash); // a is 0–1
```

### Quick start — Vue

```vue
<script setup lang="ts">
import { PlaceholderImage } from 'hazehash-vue';
</script>

<template>
  <PlaceholderImage
    hash="Ed7UwRWKKv5znm6a7sC1tziHDNpMuCikxrYpIg"
    src="/photo.jpg"
    alt="Photo"
    :width="1280"
    :height="959"
  />
</template>
```

### Quick start — Nuxt

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['hazehash-nuxt'],
});
```

```vue
<template>
  <PlaceholderImage src="/images/hero.jpg" alt="Hero" :width="1600" :height="900" />
</template>
```

The module hashes every image in `public` during the build, and the component finds the hash by `src`.

### Quick start — Command line

```bash
npx hazehash encode ./images -r -f json -o hashes.json
npx hazehash decode Ed7UwRWKKv5znm6a7sC1tziHDNpMuCikxrYpIg -o preview.png
npx hazehash info Ed7UwRWKKv5znm6a7sC1tziHDNpMuCikxrYpIg
```

### More examples

#### Files on disk

```ts
import { encodeFileToString } from 'hazehash/node'; // needs sharp

const hash = await encodeFileToString('photo.jpg', { budget: 24 });
// "Ec7UwRWKIv5znmt3XYLUF5zBSYmAo0Wr"
```

The image is converted to sRGB and rotated by its EXIF orientation before it is encoded, so the hash matches what a browser shows.

#### Colour and shape first, the preview after

```ts
import { drawToCanvas } from 'hazehash/canvas';
import { getAspectRatio, getAverageColor } from 'hazehash';

const { r, g, b } = getAverageColor(hash);
frame.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
frame.style.aspectRatio = String(getAspectRatio(hash));

drawToCanvas(hash, document.querySelector('canvas') as HTMLCanvasElement);
```

Reading the colour and the ratio touches only the header of the hash, so the box has its colour and shape at once, and the blurred frame is drawn when the script runs.

#### Storing hashes

```ts
import { encode, toBase64Url } from 'hazehash/encode';
import { toBytes } from 'hazehash';

const bytes = encode(image); // Uint8Array, for a BYTEA / BLOB column (about 25% smaller)
const text = toBase64Url(bytes); // for a VARCHAR(40) column or JSON
const back = toBytes(text); // the same bytes again
```

#### Choosing a budget

| Budget | Characters | Mean ΔE | Comment                            |
| ------ | ---------- | ------- | ---------------------------------- |
| 16     | 22         | 8.41    | the smallest practical hash        |
| 20     | 27         | 7.89    | still 14% better than ThumbHash    |
| 24     | 32         | 7.54    | a good size and quality compromise |
| 28     | 38         | 7.29    | the default                        |
| 36     | 48         | 7.00    | more detail when size is no issue  |

Mean ΔE is the perceptual error in OKLab (times 100) over 513 images; lower is better.

---

## Development

```bash
pnpm install
pnpm build         # all packages
pnpm test          # builds, then the unit tests of core, vue and nuxt
pnpm typecheck
pnpm lint
pnpm e2e           # Chromium, Firefox, WebKit, Cloudflare Workers runtime, Nuxt SSR
pnpm demo          # a Nuxt app with 17 images next to their placeholders
pnpm bench         # full benchmark -> bench/out/{report.html,results.csv,summary.csv}
node scripts/fetch-test-images.mjs   # downloads the local benchmark set into test-images/
```

Core scripts (`pnpm --filter hazehash <script>`): `size` (bundle sizes), `fuzz`, `make-vectors`
(the frozen conformance vectors; refuses to overwrite). Building needs Node.js 22+ and pnpm; the
published packages support Node.js 20+.

---

## Documentation & links

- 📖 **Full documentation:** [npm.vuecraft.ru/en/packages/hazehash](https://npm.vuecraft.ru/en/packages/hazehash/guide/overview.html)
- 🌐 **VueCraft:** [vuecraft.ru/en](https://vuecraft.ru/en)
- 👤 **Author:** [macrulez.ru/en](https://macrulez.ru/en)
- 💻 **GitHub:** [macrulezru/hazehash](https://github.com/macrulezru/hazehash)
- 📦 **NPM:** [hazehash](https://www.npmjs.com/package/hazehash), [hazehash-vue](https://www.npmjs.com/package/hazehash-vue), [hazehash-nuxt](https://www.npmjs.com/package/hazehash-nuxt)
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
