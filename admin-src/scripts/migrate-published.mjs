// Builds content/index.json + content/docs/*.json from the pages that are live today.
// Usage: node scripts/migrate-published.mjs [--write] [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWindow, parsePage } from './lib/dom.mjs';
import { importPublishedSite, validateImport } from '../src/shared/import-pages.js';
import { CONTENT_INDEX, docFilePath } from '../src/shared/site.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : ROOT;

const win = createWindow();
const doc = win.document;

const { pub, bodies, sources, report } = await importPublishedSite({
  readText: async rel => {
    const abs = path.join(ROOT, rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  },
  parse: html => parsePage(win, html),
  doc,
});

const items = pub.gallery.reduce((n, c) => n + c.items.length, 0);
console.log(`文章 ${pub.posts.length} · 项目 ${pub.works.length} · 画廊分类 ${pub.gallery.length}（作品 ${items}）· 关于 ${pub.about ? 1 : 0}`);
for (const line of report) console.log('! ' + line);

const problems = validateImport({ bodies, sources, doc });
for (const p of problems) {
  console.log(`✗ ${p.id}: ${p.stable ? '' : '二次解析不一致 '}${p.textOk ? '' : `文字不一致 (原 ${p.beforeLen} / 新 ${p.afterLen})`}`);
  if (p.textAt) console.log(`    原文: …${p.textAt.before}\n    新文: …${p.textAt.after}`);
  if (p.jsonAt) console.log(`    首次: …${p.jsonAt.first}\n    二次: …${p.jsonAt.second}`);
}
console.log(problems.length ? `往返校验：${problems.length} 篇有差异` : '往返校验：全部通过');

if (WRITE) {
  const write = (rel, data) => {
    const abs = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  };
  pub.rev = 1;
  write(CONTENT_INDEX, JSON.stringify(pub, null, 1) + '\n');
  for (const [id, json] of bodies) write(docFilePath(id), JSON.stringify({ id, doc: json }) + '\n');
  console.log(`已写入 ${path.join(OUT, 'content')}`);
}
