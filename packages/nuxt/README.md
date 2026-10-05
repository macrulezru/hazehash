# hazehash-nuxt

Nuxt 3 module for [HazeHash](../core) placeholders. It registers the `PlaceholderImage`
component and generates hashes for your images at build time, so the component works with just a
`src`.

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

On the server the markup contains only the average colour and the aspect ratio. In the browser
the blurred preview is drawn into a canvas and the real image fades in over it.

## How it works

1. At build time the module scans the configured directories and encodes every image with
   `hazehash/node` (needs the optional peer `sharp`). Results are cached per file (size and mtime)
   in `node_modules/.cache/hazehash/manifest.json`, so unchanged images are not re-encoded.
2. The manifest `{ "/images/hero.jpg": "Ebs0QP3d..." }` is exposed as the virtual module
   `#hazehash/manifest`.
3. The component looks up `hash` by `src` when no `hash` prop is given. A hash passed explicitly
   always wins, which is the way to use hashes stored in a database or CMS.
4. In development the manifest is regenerated when an image in a scanned directory changes.

If `sharp` is missing or an image cannot be decoded, the build continues and a warning is printed.

## Options

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

## Auto-imports

- `useHazeHash(src)` returns a computed hash for an image URL, or `undefined`.
- `usePlaceholder(hash, { size })` comes from `hazehash-vue` for custom markup.

## Requirements

Nuxt 3.9 or newer, Node.js 20+, and `sharp` installed in your project for build-time generation.
