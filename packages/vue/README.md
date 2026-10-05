# hazehash-vue

Vue 3 component and composable for [HazeHash](../core) placeholders.

```vue
<script setup lang="ts">
import { PlaceholderImage } from 'hazehash-vue';
</script>

<template>
  <PlaceholderImage hash="EAAQPvgAAA" src="/photo.jpg" alt="Photo" :width="1200" :height="800" />
</template>
```

- Server render: only `background-color` (average colour) and `aspect-ratio` are emitted, so
  hydration cannot mismatch.
- Client: the preview is drawn into a `<canvas>` (`aria-hidden`) and the real `<img>` fades in over
  it on `load`; already-cached images are detected through `img.complete`.
- `width`/`height`, when both are set, define the aspect ratio; otherwise it comes from the hash.
- `prefers-reduced-motion: reduce` disables the fade.
- An invalid hash never throws: a flat background remains and one `console.warn` is printed.

Props: `hash`, `src`, `alt`, `width`, `height`, `size` (32), `fade` (300 ms).

`usePlaceholder(hash, { size })` exposes `canvas` (template ref), `backgroundColor`, `aspectRatio`,
`average` and `mounted` for custom markup.
