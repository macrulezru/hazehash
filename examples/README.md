# Examples

| File              | What it shows                                                          |
| ----------------- | ---------------------------------------------------------------------- |
| `node-folder.mjs` | Encode a folder of images into `hashes.json` (Node.js, needs `sharp`). |
| `browser.html`    | Encode a canvas, then show the placeholder with `drawToCanvas`.        |

```sh
pnpm install && pnpm build
pnpm --filter hazehash-examples hashes -- ./path/to/images 28
pnpm --filter hazehash-examples serve      # then open /examples/browser.html
```

## Vue 3

```vue
<script setup lang="ts">
import { PlaceholderImage } from 'hazehash-vue';
const photo = { src: '/photo.jpg', hash: 'Ebs0QP3dKv73c2scoqwFUA', width: 1200, height: 800 };
</script>

<template>
  <PlaceholderImage v-bind="photo" alt="Mountain lake" />
</template>
```

## Storing hashes

A 28-byte hash fits a `BYTEA`/`BLOB` column (about 25% smaller than text) or a `VARCHAR(40)`.
Use `toBase64Url` / `toBytes` to convert between the two forms.

```ts
import { encode } from 'hazehash/encode';

const bytes = encode(image); // Uint8Array, store in a binary column
const text = Buffer.from(bytes).toString('base64url'); // or keep the text form
```
