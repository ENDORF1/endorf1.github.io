import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(HERE, '..');
const EDITOR_BUNDLE = path.join(HERE, 'dist-editor', 'editor.js');

// Stage 2 embeds the stage-1 editor runtime as gzip+base64 so admin.html stays one file.
function editorBundle() {
  const id = 'virtual:editor-bundle';
  let command = 'serve';
  return {
    name: 'devlog-editor-bundle',
    configResolved(cfg) { command = cfg.command; },
    resolveId(source) { return source === id ? '\0' + id : null; },
    load(resolved) {
      if (resolved !== '\0' + id) return null;
      if (command === 'serve') return 'export default null;';
      if (!fs.existsSync(EDITOR_BUNDLE)) throw new Error('dist-editor/editor.js 不存在，请先运行 vite build --config vite.editor.config.js');
      const gz = zlib.gzipSync(fs.readFileSync(EDITOR_BUNDLE), { level: 9 });
      return `export default ${JSON.stringify(gz.toString('base64'))};`;
    },
  };
}

// Dev only: serve the live site files (content/, blog/, images/ …) from the repo root.
const MIME = { '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.css': 'text/css' };
function siteFiles() {
  return {
    name: 'devlog-site-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url || '').split('?')[0]);
        if (!/^\/(content|blog|works|gallery|images)\/|^\/about\.html$/.test(url)) return next();
        const rel = url.endsWith('/') ? url + 'index.html' : url;
        const staged = path.join(HERE, '.tmp', 'site', rel);
        const file = url.startsWith('/content/') && fs.existsSync(staged) ? staged : path.join(SITE_ROOT, rel);
        if (!(file.startsWith(SITE_ROOT)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(file).pipe(res);
      });
    },
  };
}

export const PREACT_ALIAS = [
  { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/jsx-dev-runtime' },
  { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
  { find: /^react-dom$/, replacement: 'preact/compat' },
  { find: /^react$/, replacement: 'preact/compat' },
];

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  resolve: { alias: PREACT_ALIAS },
  plugins: [editorBundle(), siteFiles(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    modulePreload: false,
  },
  server: { port: 5173, strictPort: false },
  // In dev the editor iframe loads src/editor/entry.js by URL, which the dependency scan can't see from index.html.
  optimizeDeps: { entries: ['index.html', 'src/editor/entry.js'] },
});
