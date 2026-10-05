# HazeHash demo

A small Nuxt app that shows 17 images next to the placeholders rebuilt from their hashes, with
the hash string, its size, the original's size and how much smaller the hash is. It uses the
[`hazehash-nuxt`](../packages/nuxt) module: hashes for everything in `public/images` are generated
at build time, and `<PlaceholderImage :hash="…">` draws the placeholder (the server renders only
the average colour and the aspect ratio, the canvas is painted in the browser).

```sh
pnpm install
pnpm build                          # the demo uses the built packages
pnpm --filter hazehash-demo dev     # http://localhost:3000
pnpm --filter hazehash-demo generate  # static site in demo/.output/public
```

## Images

`public/images` holds 17 images from Wikimedia Commons, resized to 600 px on the long side, and
`data/images.json` has their sizes and attribution (shown at the bottom of the page). Only public
domain, CC0 and CC BY images are used. To change the selection, fetch the benchmark set
(`node scripts/fetch-test-images.mjs` in the repository root), edit the `plan` in
`scripts/prepare-images.mjs` and run `pnpm --filter hazehash-demo prepare-images`.
