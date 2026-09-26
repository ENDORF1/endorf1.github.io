import { defineConfig } from 'vite';

// Stage 1: the editor runtime that executes inside the canvas iframe.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  resolve: {
    alias: [
      { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/jsx-dev-runtime' },
      { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
      { find: /^react-dom$/, replacement: 'preact/compat' },
      { find: /^react$/, replacement: 'preact/compat' },
    ],
  },
  build: {
    outDir: 'dist-editor',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      input: 'src/editor/entry.js',
      preserveEntrySignatures: false,
      output: {
        codeSplitting: false,
        entryFileNames: 'editor.js',
        format: 'es',
      },
    },
  },
});
