// Copies the single-file build to the site root as admin.html, keeping the
// previous admin available as admin-legacy.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../dist/index.html');
const ROOT = path.resolve(HERE, '../..');
const TARGET = path.join(ROOT, 'admin.html');
const LEGACY = path.join(ROOT, 'admin-legacy.html');
const MARKER = '<meta name="generator" content="devlog-admin 2">';

const html = fs.readFileSync(SRC, 'utf8');

const problems = [];
if (!html.includes(MARKER)) problems.push('缺少版本标记');
const closes = (html.match(/<\/script/gi) || []).length;
const opens = (html.match(/<script[\s>]/gi) || []).length;
if (closes !== 1) problems.push(`内联脚本里出现了 ${closes - 1} 处未转义的 </script`);
if (html.includes('<!--')) problems.push('内联脚本里出现了 <!--');
if (/src="\/assets\/|href="\/assets\//.test(html)) problems.push('仍有未内联的资源引用');
if (problems.length) {
  console.error('构建产物检查失败：\n- ' + problems.join('\n- '));
  process.exit(1);
}

if (fs.existsSync(TARGET) && !fs.existsSync(LEGACY)) {
  const current = fs.readFileSync(TARGET, 'utf8');
  if (!current.includes(MARKER)) {
    fs.copyFileSync(TARGET, LEGACY);
    console.log('旧版后台已保留为 admin-legacy.html');
  }
}

fs.writeFileSync(TARGET, html);
console.log(`admin.html 已生成（${(html.length / 1024).toFixed(0)} KB，脚本标签 ${opens} 处文本 / 1 处真实）`);
