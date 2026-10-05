import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    decode: 'src/decode.ts',
    encode: 'src/encode.ts',
    canvas: 'src/canvas.ts',
    node: 'src/node.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  target: 'es2020',
  dts: true,
  clean: true,
  fixedExtension: false,
  external: ['sharp'],
});
