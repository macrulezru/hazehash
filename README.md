# HazeHash

Compact image placeholders: a 16–48 byte string (28 by default) that decodes in a fraction of a
millisecond into a blurred preview with the right aspect ratio and, when needed, transparency.
At the same size it has about 49% lower perceptual error than BlurHash and 20% lower than
ThumbHash.

```ts
import { encodeToString } from 'hazehash/encode';
import { decode } from 'hazehash';

const hash = encodeToString({ data: rgba, width, height }); // "Ebs0QP3dKv73c2scoqwFUA"
const preview = decode(hash); // { width, height, data } RGBA, 32 px on the long side
```

| Package                        | Purpose                                                     |
| ------------------------------ | ----------------------------------------------------------- |
| [hazehash](packages/core)      | encoder, decoder, canvas and Node helpers, CLI              |
| [hazehash-vue](packages/vue)   | Vue 3 component and composable                              |
| [hazehash-nuxt](packages/nuxt) | Nuxt module: component auto-registration, build-time hashes |

Live-style demo: [demo/](demo) (`pnpm demo`) shows 17 images next to their placeholders.

Documentation: [examples](examples).

## Development

```sh
pnpm install
pnpm build         # all packages
pnpm test          # builds, then unit tests of core, vue and nuxt
pnpm typecheck
pnpm lint
pnpm e2e           # Chromium, Firefox, WebKit, Cloudflare Workers runtime, Nuxt SSR
node scripts/fetch-test-images.mjs   # downloads the local benchmark set into test-images/
pnpm bench         # full benchmark -> bench/out/{report.html,results.csv,summary.csv}
pnpm bench --limit 50 --seed 1       # reduced set, used in CI
pnpm ablate        # design-choice ablation
pnpm tune          # parameter sweeps
```

Core scripts (`pnpm --filter hazehash <script>`): `size` (bundle sizes), `fuzz`, `make-vectors`
(frozen conformance vectors; refuses to overwrite). Requires Node.js 20+ and pnpm.
