import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  target: 'es2020',
  dts: true,
  clean: true,
  fixedExtension: false,
  external: ['vue', 'hazehash', /^hazehash\//],
});
