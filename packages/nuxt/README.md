# **HazeHash Nuxt**

![HazeHash Nuxt](https://github.com/macrulezru/assets/blob/master/packages-images/hazehash-nuxt-vuecraft.webp?raw=true)

Nuxt module for [HazeHash](https://www.npmjs.com/package/hazehash) placeholders: it registers the
`PlaceholderImage` component and generates the hashes of your images during the build, so the
component works with just a `src`. On the server the markup contains only the average colour and
the aspect ratio; in the browser the blurred preview is drawn into a canvas and the real image
fades in over it.

Part of the [hazehash](https://github.com/macrulezru/hazehash) monorepo. Core package and Vue
wrapper: [`hazehash`](https://www.npmjs.com/package/hazehash),
[`hazehash-vue`](https://www.npmjs.com/package/hazehash-vue).

---

## Features

- **Hashes generated during the build** — the module scans the configured folders and encodes every image once, with no command to run
- **A component that needs only a `src`** — `<PlaceholderImage>` looks the hash up by the image URL; a `hash` passed explicitly always wins, which is the way to use hashes stored in a database or a CMS
- **A cache by file size and modification time** — results are kept in `node_modules/.cache/hazehash/manifest.json` together with the budget and the profile, so unchanged images are not encoded again
- **Regenerated while you develop** — when an image in a scanned folder is added, changed or removed, the manifest is rebuilt
- **A failure never breaks the build** — a missing `sharp` disables generation with one warning, and an image that cannot be decoded is skipped with a warning
- **Auto-imports** — `useHazeHash(src)` and `usePlaceholder()` are available without an import
- **Hydration cannot mismatch** — the server renders only the average colour and the aspect ratio, and the canvas is added after mount

---

## When you'd reach for this

You are on Nuxt, your images live in the project, and you want a blurred placeholder for each of them without maintaining a list of hashes.

- **A site with a `public` folder full of photos** — Add the module, and every image there gets its hash during the build, with no script and no manual step.
- **A project that rebuilds often** — The cache by file size and modification time means only new and changed images are encoded again.
- **A mix of local images and hashes from a database** — Local images take the generated hash by `src`, and records from a database pass their own `hash`.

---

## Installation

```bash
npm install hazehash-nuxt
npm install --save-dev sharp
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['hazehash-nuxt'],
});
```

Requires Nuxt `^3.9.0` and Node.js `20+`. `sharp` is needed in your project for the build-time generation; without it the module prints a warning and the component works only with an explicit `hash`.

### Quick start

```vue
<template>
  <PlaceholderImage src="/images/hero.jpg" alt="Hero" :width="1600" :height="900" />
</template>
```

### More examples

#### How it works

1. At build time the module scans the configured directories and encodes every image with `hazehash/node`. Results are cached per file (size and mtime) in `node_modules/.cache/hazehash/manifest.json`, so unchanged images are not encoded again.
2. The manifest `{ "/images/hero.jpg": "Ed7UwRWKKv5znm6a7sC1tziHDNpMuCikxrYpIg" }` is exposed as the virtual module `#hazehash/manifest`.
3. The component looks up `hash` by `src` when no `hash` prop is given. A hash passed explicitly always wins.
4. In development the manifest is regenerated when an image in a scanned directory changes.

If `sharp` is missing or an image cannot be decoded, the build continues and a warning is printed.

#### Options

```ts
export default defineNuxtConfig({
  modules: ['hazehash-nuxt'],
  hazehash: {
    componentName: 'PlaceholderImage', // name of the registered component
    generate: true, // set to false to use only explicit `hash` props
    dirs: [{ dir: 'public', prefix: '/' }], // directories and the URL prefix of their files
    extensions: ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'],
    budget: 28, // maximum bytes per hash
    profile: 'default', // 'fast' | 'default' | 'high'
  },
});
```

A file `public/images/hero.jpg` in the default directory gets the key `/images/hero.jpg`, which is the `src` you write in the template. A folder that your server publishes under another URL takes a `prefix`: `{ dir: 'media/photos', prefix: '/photos/' }`.

#### Hashes stored elsewhere

```ts
hazehash: {
  generate: false,
}
```

```vue
<PlaceholderImage
  :src="photo.url"
  :hash="photo.hash"
  :width="photo.width"
  :height="photo.height"
  alt=""
/>
```

To produce those hashes, use the command that comes with `hazehash`: `npx hazehash encode ./public/images -f json -o hashes.json`.

#### Auto-imports

```vue
<script setup lang="ts">
const props = defineProps<{ src: string }>();
const hash = useHazeHash(() => props.src); // ComputedRef<string | undefined>
const { canvas, backgroundColor, aspectRatio } = usePlaceholder(hash);
</script>
```

`useHazeHash(src)` returns the generated hash for an image URL, or `undefined`. `usePlaceholder(hash, { size })` comes from `hazehash-vue` for custom markup.

---

## Documentation & links

- 📖 **Full documentation:** [npm.vuecraft.ru/en/packages/hazehash](https://npm.vuecraft.ru/en/packages/hazehash/guide/nuxt-module.html)
- 🌐 **VueCraft:** [vuecraft.ru/en](https://vuecraft.ru/en)
- 👤 **Author:** [macrulez.ru/en](https://macrulez.ru/en)
- 💻 **GitHub:** [macrulezru/hazehash/packages/nuxt](https://github.com/macrulezru/hazehash/tree/master/packages/nuxt)
- 📦 **NPM:** [hazehash-nuxt](https://www.npmjs.com/package/hazehash-nuxt)
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
