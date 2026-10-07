# **HazeHash Vue**

![HazeHash Vue](https://github.com/macrulezru/assets/blob/master/packages-images/hazehash-vue-vuecraft.webp?raw=true)

Vue 3 component and composable for [HazeHash](https://www.npmjs.com/package/hazehash) placeholders:
`<PlaceholderImage>` reserves the space with the right aspect ratio, draws the blurred preview into
a canvas and fades the real image in over it. On the server it renders only the average colour and
the aspect ratio, so hydration cannot mismatch.

Part of the [hazehash](https://github.com/macrulezru/hazehash) monorepo. Core package and Nuxt
module: [`hazehash`](https://www.npmjs.com/package/hazehash),
[`hazehash-nuxt`](https://www.npmjs.com/package/hazehash-nuxt).

---

## Features

- **One component for the image and its placeholder** — `<PlaceholderImage>` takes a `hash` and a `src`, and renders the preview, the image and the fade between them
- **Hydration cannot mismatch** — on the server only `background-color` (the average colour) and `aspect-ratio` are emitted; the canvas is added after mount
- **A canvas preview that fades into the real image** — the blurred frame is drawn into an `aria-hidden` `<canvas>`, and the `<img>` fades in over it on `load`; an image that was already cached is detected through `img.complete` and appears at once
- **Aspect ratio from your data or from the hash** — `width` and `height`, when both are set, define the ratio, and otherwise it comes from the hash
- **Respects reduced motion** — `prefers-reduced-motion: reduce` turns the fade off
- **An invalid hash never throws** — a flat background remains and one `console.warn` is printed for the whole page
- **A composable for your own markup** — `usePlaceholder()` returns the canvas ref, the background colour, the aspect ratio and a client flag for a hash that can be a value, a ref or a getter

---

## When you'd reach for this

You already have hashes, or can make them ahead of time, and want Vue to show them without writing the canvas and fade logic yourself.

- **An image grid or a catalogue** — Every card gets a blurred frame of the right proportions at once, so the page does not jump when the photos arrive.
- **A server-rendered Vue app** — The markup the server sends and the first client render are identical, so there is no hydration warning, and no `<ClientOnly>` wrapper is needed.
- **A custom card that needs the placeholder's colour or ratio** — `usePlaceholder()` hands you the pieces, and you keep full control of the markup.

---

## Installation

```bash
npm install hazehash hazehash-vue
```

Requires Vue `^3.3.0` and Node.js `20+`. `hazehash` is a peer dependency.

The component only draws hashes. Create them ahead of time with the command line that comes with `hazehash`:

```bash
npm install --save-dev sharp   # lets the command read images
npx hazehash encode ./public/images -f json -o hashes.json
```

### Quick start

```vue
<script setup lang="ts">
import { PlaceholderImage } from 'hazehash-vue';
</script>

<template>
  <PlaceholderImage
    hash="Ed7UwRWKKv5znm6a7sC1tziHDNpMuCikxrYpIg"
    src="/photo.jpg"
    alt="Mountain lake"
    :width="1280"
    :height="959"
  />
</template>
```

### More examples

#### Hashes from your data

```vue
<script setup lang="ts">
import { PlaceholderImage } from 'hazehash-vue';

defineProps<{
  photos: { url: string; hash: string; width: number; height: number; title: string }[];
}>();
</script>

<template>
  <PlaceholderImage
    v-for="photo in photos"
    :key="photo.url"
    :src="photo.url"
    :hash="photo.hash"
    :width="photo.width"
    :height="photo.height"
    :alt="photo.title"
  />
</template>
```

#### Props

| Prop     | Type               | Default     | Meaning                                                            |
| -------- | ------------------ | ----------- | ------------------------------------------------------------------ |
| `hash`   | `string`           | `undefined` | the HazeHash of the image; without it only the `<img>` renders     |
| `src`    | `string`           | `undefined` | the URL of the real image; without it only the placeholder renders |
| `alt`    | `string`           | `''`        | the `alt` text of the image                                        |
| `width`  | `number \| string` | `undefined` | intrinsic width; with `height` it defines the aspect ratio         |
| `height` | `number \| string` | `undefined` | intrinsic height                                                   |
| `size`   | `number`           | `32`        | long side of the decoded preview in pixels (4–128)                 |
| `fade`   | `number`           | `300`       | fade-in of the real image in milliseconds; `0` for no transition   |

The root `<div>` takes `class` and `style` like any block, and has no emits and no slots.

#### Styling

```vue
<PlaceholderImage class="avatar" :hash="hash" :src="url" :width="64" :height="64" alt="" />
```

```css
.avatar {
  width: 64px;
  border-radius: 50%;
}
```

The height comes from the aspect ratio, and rounded corners work because the root clips its content.

#### `usePlaceholder()` for your own markup

```vue
<script setup lang="ts">
import { usePlaceholder } from 'hazehash-vue';

const props = defineProps<{ hash: string }>();
const { canvas, backgroundColor, aspectRatio } = usePlaceholder(() => props.hash, { size: 64 });
</script>

<template>
  <div :style="{ backgroundColor, aspectRatio }">
    <canvas ref="canvas" aria-hidden="true" />
  </div>
</template>
```

`usePlaceholder(hash, { size })` returns `canvas` (a template ref), `mounted`, `average`, `aspectRatio` and `backgroundColor`. On the server only `average`, `aspectRatio` and `backgroundColor` have values, and the canvas is drawn after mount.

---

## Documentation & links

- 📖 **Full documentation:** [npm.vuecraft.ru/en/packages/hazehash](https://npm.vuecraft.ru/en/packages/hazehash/guide/placeholder-image.html)
- 🌐 **VueCraft:** [vuecraft.ru/en](https://vuecraft.ru/en)
- 👤 **Author:** [macrulez.ru/en](https://macrulez.ru/en)
- 💻 **GitHub:** [macrulezru/hazehash/packages/vue](https://github.com/macrulezru/hazehash/tree/master/packages/vue)
- 📦 **NPM:** [hazehash-vue](https://www.npmjs.com/package/hazehash-vue)
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
