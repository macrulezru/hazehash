import {
  addComponent,
  addImports,
  addTemplate,
  addTypeTemplate,
  createResolver,
  defineNuxtModule,
  updateTemplates,
} from '@nuxt/kit';
import type { NuxtModule } from '@nuxt/schema';
import { join, resolve } from 'node:path';
import { buildManifest, type GenerateOptions, type Manifest, type SourceDir } from './generate';

export interface ModuleOptions {
  /** Name of the registered component. Default 'PlaceholderImage'. */
  componentName: string;
  /** Generate hashes for images found in `dirs` at build time. Default true. */
  generate: boolean;
  /** Directories to scan. Default: the `public` directory served at '/'. */
  dirs: SourceDir[];
  /** File extensions treated as images. */
  extensions: string[];
  /** Maximum bytes per hash. Default 28. */
  budget: number;
  profile: 'fast' | 'default' | 'high';
}

const MANIFEST_FILE = 'hazehash-manifest.mjs';

const hazehashModule: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'hazehash',
    configKey: 'hazehash',
    compatibility: { nuxt: '>=3.9.0' },
  },
  defaults: {
    componentName: 'PlaceholderImage',
    generate: true,
    dirs: [{ dir: 'public', prefix: '/' }],
    extensions: ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'],
    budget: 28,
    profile: 'default',
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);

    addComponent({
      name: options.componentName,
      filePath: resolver.resolve('./runtime/components/HazeImage'),
    });
    addImports({ name: 'useHazeHash', from: resolver.resolve('./runtime/composables') });
    addImports({ name: 'usePlaceholder', from: 'hazehash-vue' });
    nuxt.options.build.transpile.push('hazehash', 'hazehash-vue');

    const generateOptions: GenerateOptions = {
      dirs: options.dirs,
      extensions: options.extensions,
      budget: options.budget,
      profile: options.profile,
      cacheFile: join(nuxt.options.rootDir, 'node_modules/.cache/hazehash/manifest.json'),
    };

    let manifest: Manifest = {};
    const regenerate = async (): Promise<void> => {
      if (!options.generate) return;
      try {
        // hazehash/node needs the optional peer `sharp`; fail soft when it is missing.
        const { encodeFileToString } = await import('hazehash/node');
        manifest = await buildManifest(
          nuxt.options.rootDir,
          generateOptions,
          (path, o) => encodeFileToString(path, o),
          (message) => console.warn(message),
        );
      } catch (error) {
        console.warn(`[hazehash] hash generation disabled: ${(error as Error).message}`);
      }
    };
    await regenerate();

    const template = addTemplate({
      filename: MANIFEST_FILE,
      write: true,
      getContents: () => `export default ${JSON.stringify(manifest, null, 2)};\n`,
    });
    nuxt.options.alias['#hazehash/manifest'] = template.dst;

    addTypeTemplate({
      filename: 'types/hazehash.d.ts',
      getContents: () =>
        `declare module '#hazehash/manifest' {\n  const manifest: Record<string, string>;\n  export default manifest;\n}\n`,
    });

    // In development, regenerate when an image inside a scanned directory changes.
    const roots = options.dirs.map((d) => resolve(nuxt.options.rootDir, d.dir));
    nuxt.hook('builder:watch', async (_event, path) => {
      const absolute = resolve(nuxt.options.srcDir, path);
      const ext = absolute.slice(absolute.lastIndexOf('.')).toLowerCase();
      if (!options.extensions.includes(ext) || !roots.some((r) => absolute.startsWith(r))) return;
      await regenerate();
      await updateTemplates({ filter: (t) => t.filename === MANIFEST_FILE });
    });
  },
});

export default hazehashModule;
