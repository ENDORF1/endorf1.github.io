// End-to-end test for the admin. Drives the real UI in headless Chrome against a
// mocked GitHub API whose starting state is the local git HEAD, so nothing is sent
// to GitHub. Usage: node scripts/e2e.mjs [--built] [--keep] [--chrome <path>]
//   --built   test dist/index.html (run `npm run build` first) instead of the dev server
//   --keep    leave screenshots and page dumps in .tmp/e2e
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = path.resolve(ROOT, '..');
const OUT = path.join(ROOT, '.tmp', 'e2e');
const args = process.argv.slice(2);
const BUILT = args.includes('--built');
const CHROME = args.includes('--chrome') ? args[args.indexOf('--chrome') + 1] : findChrome();
const USER = 'endorf1';
const REPO = 'endorf1.github.io';
const PASSWORD = 'admin888';

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find(p => p && fs.existsSync(p));
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- mock repository ---------------- */

const sha1 = (...parts) => {
  const h = crypto.createHash('sha1');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};
const blobSha = buf => sha1(`blob ${buf.length}\0`, buf);

class MockRepo {
  constructor(dir) {
    this.dir = dir;
    this.blobs = new Map();
    this.trees = new Map();
    this.commits = new Map();
    this.log = [];
    this.failNextRef = false;
    this.beforeRefUpdate = null;
    const out = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-tree', '-r', '-z', 'HEAD'], { cwd: dir, maxBuffer: 64 << 20 }).toString('utf8');
    const tree = new Map();
    for (const rec of out.split('\0')) {
      if (!rec) continue;
      const tab = rec.indexOf('\t');
      const [, type, sha] = rec.slice(0, tab).split(' ');
      if (type === 'blob') tree.set(rec.slice(tab + 1), sha);
    }
    const treeSha = this.putTree(tree);
    this.head = this.putCommit({ tree: treeSha, parents: [], message: 'HEAD' });
    this.initialTree = tree;
  }

  blob(sha) {
    if (!this.blobs.has(sha)) this.blobs.set(sha, execFileSync('git', ['cat-file', 'blob', sha], { cwd: this.dir, maxBuffer: 1 << 30 }));
    return this.blobs.get(sha);
  }

  putBlob(buf) {
    const sha = blobSha(buf);
    this.blobs.set(sha, buf);
    return sha;
  }

  putTree(map) {
    const sha = sha1('tree', JSON.stringify([...map.entries()].sort()));
    this.trees.set(sha, new Map(map));
    return sha;
  }

  putCommit(c) {
    const sha = sha1('commit', JSON.stringify(c), String(Math.random()));
    this.commits.set(sha, c);
    return sha;
  }

  headTree() {
    return this.trees.get(this.commits.get(this.head).tree);
  }

  file(p, tree = this.headTree()) {
    const sha = tree.get(p);
    return sha ? this.blob(sha) : null;
  }

  text(p, tree) {
    const b = this.file(p, tree);
    return b ? b.toString('utf8') : null;
  }

  /** Commits a change directly, as if someone pushed from elsewhere. */
  pushExternal(p, content, message) {
    const tree = new Map(this.headTree());
    tree.set(p, this.putBlob(Buffer.from(content)));
    this.head = this.putCommit({ tree: this.putTree(tree), parents: [this.head], message });
  }

  diff(fromCommit, toCommit = this.head) {
    const a = this.trees.get(this.commits.get(fromCommit).tree);
    const b = this.trees.get(this.commits.get(toCommit).tree);
    const changed = [];
    for (const [p, s] of b) if (a.get(p) !== s) changed.push({ path: p, type: a.has(p) ? 'M' : 'A' });
    for (const p of a.keys()) if (!b.has(p)) changed.push({ path: p, type: 'D' });
    return changed.sort((x, y) => x.path.localeCompare(y.path));
  }
}

const repo = new MockRepo(REPO_DIR);
const startCommit = repo.head;

const json = (route, status, body) => route.fulfill({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
  body: body === undefined ? '' : JSON.stringify(body),
});

async function githubApi(route) {
  const req = route.request();
  const method = req.method();
  if (method === 'OPTIONS') return json(route, 204);
  const url = new URL(req.url());
  const prefix = `/repos/${USER}/${REPO}`;
  if (!url.pathname.toLowerCase().startsWith(prefix.toLowerCase())) return json(route, 404, { message: 'Not Found' });
  const p = decodeURIComponent(url.pathname.slice(prefix.length));
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  repo.log.push(`${method} ${p}`);
  let m;
  if (method === 'GET' && p === '') return json(route, 200, { full_name: `${USER}/${REPO}`, size: 1000, default_branch: 'main', permissions: { admin: true, push: true, pull: true } });
  if (method === 'GET' && p === '/git/ref/heads/main') return json(route, 200, { ref: 'refs/heads/main', object: { sha: repo.head, type: 'commit' } });
  if (method === 'GET' && (m = /^\/git\/commits\/(\w+)$/.exec(p))) {
    const c = repo.commits.get(m[1]);
    return c ? json(route, 200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map(sha => ({ sha })), message: c.message }) : json(route, 404, { message: 'Not Found' });
  }
  if (method === 'GET' && (m = /^\/git\/trees\/(\w+)$/.exec(p))) {
    const t = repo.trees.get(m[1]);
    if (!t) return json(route, 404, { message: 'Not Found' });
    return json(route, 200, { sha: m[1], truncated: false, tree: [...t].map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha })) });
  }
  if (method === 'GET' && (m = /^\/git\/blobs\/(\w+)$/.exec(p))) {
    const b = repo.blob(m[1]);
    return json(route, 200, { sha: m[1], size: b.length, encoding: 'base64', content: b.toString('base64').replace(/.{60}/g, '$&\n') });
  }
  if (method === 'GET' && (m = /^\/contents\/(.+)$/.exec(p))) {
    const file = repo.file(m[1]);
    if (!file) return json(route, 404, { message: 'Not Found' });
    return json(route, 200, { type: 'file', path: m[1], sha: blobSha(file), encoding: 'base64', content: file.toString('base64') });
  }
  if (method === 'POST' && p === '/git/blobs') return json(route, 201, { sha: repo.putBlob(Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8')) });
  if (method === 'POST' && p === '/git/trees') {
    const base = body.base_tree ? repo.trees.get(body.base_tree) : new Map();
    if (!base) return json(route, 422, { message: 'base_tree not found' });
    const next = new Map(base);
    for (const e of body.tree) {
      if (e.sha === null) next.delete(e.path);
      else next.set(e.path, e.sha);
    }
    return json(route, 201, { sha: repo.putTree(next) });
  }
  if (method === 'POST' && p === '/git/commits') return json(route, 201, { sha: repo.putCommit({ tree: body.tree, parents: body.parents, message: body.message }) });
  if (method === 'PATCH' && p === '/git/refs/heads/main') {
    if (repo.beforeRefUpdate) { const fn = repo.beforeRefUpdate; repo.beforeRefUpdate = null; fn(); }
    const c = repo.commits.get(body.sha);
    if (repo.failNextRef || !c || c.parents[0] !== repo.head) {
      repo.failNextRef = false;
      return json(route, 422, { message: 'Update is not a fast forward' });
    }
    repo.head = body.sha;
    return json(route, 200, { ref: 'refs/heads/main', object: { sha: body.sha } });
  }
  return json(route, 404, { message: `mock: unhandled ${method} ${p}` });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const serveTree = treeFn => route => {
  const url = new URL(route.request().url());
  let p = decodeURIComponent(url.pathname).replace(/^\//, '');
  if (!p || p.endsWith('/')) p += 'index.html';
  const file = repo.file(p, treeFn());
  if (!file) return route.fulfill({ status: 404, body: 'not found', headers: { 'access-control-allow-origin': '*' } });
  return route.fulfill({ status: 200, body: file, headers: { 'content-type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
};

/* ---------------- app server ---------------- */

let server = null;
let appUrl;
if (BUILT) {
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'));
  server = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/admin.html') || req.url.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  appUrl = `http://127.0.0.1:${server.address().port}/admin.html`;
} else {
  // No HMR: editing sources while the run is in progress must not reload the page under test.
  server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.js'), server: { port: 0, strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  appUrl = server.resolvedUrls.local[0];
}

/* ---------------- browser ---------------- */

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.route('https://api.github.com/**', githubApi);
await ctx.route(`https://${USER}.github.io/**`, serveTree(() => repo.headTree()));
await ctx.route('https://old.site.test/**', serveTree(() => repo.initialTree));
await ctx.route('https://new.site.test/**', serveTree(() => repo.headTree()));
await ctx.route('https://cdn.jsdelivr.net/gh/**', route => {
  const m = /\/gh\/[^/]+\/[^/@]+@[^/]+\/(.+)$/.exec(new URL(route.request().url()).pathname);
  const file = m && repo.file(decodeURIComponent(m[1]), repo.headTree());
  return file ? route.fulfill({ status: 200, body: file, headers: { 'content-type': MIME[path.extname(m[1]).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*' } }) : route.fulfill({ status: 404, body: '' });
});
await ctx.route('https://purge.jsdelivr.net/**', route => route.fulfill({ status: 200, body: '{}', headers: { 'access-control-allow-origin': '*' } }));

const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
const fileQueue = [];
page.on('filechooser', fc => { const f = fileQueue.shift(); if (f) fc.setFiles(f); });

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0}ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n      ${String(err && err.stack || err).split('\n').slice(0, 4).join('\n      ')}`);
    await page.screenshot({ path: path.join(OUT, `fail-${results.length}.png`) }).catch(() => {});
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const shell = fn => page.evaluate(fn);
const editor = (fn, arg) => page.evaluate(([src, a]) => {
  const app = document.querySelector('iframe.canvas-frame').contentWindow.__devlogEditor;
  return new Function('app', 'arg', src)(app, a);
}, [fn, arg]);
const waitIdle = () => page.waitForFunction(() => !window.__devlogShell.store.get().publishing, null, { timeout: 60000 });
const statusOf = id => page.evaluate(id => window.__devlogShell.data.status(id), id);

async function openDoc(id) {
  await page.evaluate(id => window.__devlogShell.openDoc(id), id);
  await page.waitForFunction(id => {
    const s = window.__devlogShell;
    const f = document.querySelector('iframe.canvas-frame');
    const app = f && f.contentWindow.__devlogEditor;
    return s.store.get().currentId === id && app && app.store.get().loaded && app.store.get().docId === id;
  }, id, { timeout: 20000 });
  await page.waitForTimeout(300);
}

async function clickPublish() {
  const before = repo.head;
  await page.click('.publish-btn .btn:first-child');
  await waitIdle();
  return before;
}

/**
 * What a reader sees, independent of markup: every line of text with its box and
 * every image or frame. Two renderings with equal signatures look the same.
 */
async function layoutOf(url, width = 1440) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width, height: 900 });
  await p.goto(url, { waitUntil: 'load' });
  await p.evaluate(async () => {
    await document.fonts.ready;
    for (const img of document.images) img.loading = 'eager';
    await Promise.all([...document.images].map(img => (img.complete ? 0 : new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 5000); }))));
  });
  await p.waitForTimeout(300);
  const sig = await p.evaluate(() => {
    const rects = [];
    const range = document.createRange();
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const n = tw.currentNode;
      const text = n.textContent.replace(/\s+/g, '');
      if (!text || !n.parentElement || n.parentElement.closest('script,style,noscript,template')) continue;
      range.selectNodeContents(n);
      const list = [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5);
      list.forEach((r, i) => rects.push({ top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, text: i === 0 ? text : '' }));
    }
    rects.sort((a, b) => a.top - b.top || a.left - b.left);
    const lines = [];
    for (const r of rects) {
      const last = lines[lines.length - 1];
      const overlap = last ? Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top) : 0;
      if (last && overlap > (r.bottom - r.top) / 2) {
        last.top = Math.min(last.top, r.top); last.bottom = Math.max(last.bottom, r.bottom);
        last.left = Math.min(last.left, r.left); last.right = Math.max(last.right, r.right);
        last.text += r.text;
      } else {
        lines.push({ ...r });
      }
    }
    const out = lines.map(l => ({ kind: 'text', box: [l.left, l.top, l.right, l.bottom].map(Math.round), text: l.text.slice(0, 40) }));
    for (const el of document.querySelectorAll('img,video,iframe,canvas')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue;
      out.push({ kind: el.tagName.toLowerCase(), box: [r.left, r.top + scrollY, r.right, r.bottom + scrollY].map(Math.round), text: (el.getAttribute('src') || '').split('/').pop().slice(0, 40) });
    }
    out.push({ kind: 'page', box: [0, 0, document.documentElement.scrollWidth, document.documentElement.scrollHeight], text: '' });
    return out;
  });
  await p.close();
  return sig;
}

const DATE_RE = /\d{4}-\d{2}-\d{2}/g;

/** With ignoreDates, lines that differ only in a date are collected in `dates` instead of failing. */
function compareLayouts(a, b, { ignoreDates = false } = {}) {
  const diffs = [];
  const dates = [];
  const fmt = x => (x ? `${x.kind} [${x.box.join(',')}] ${x.text}` : '(none)');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && diffs.length < 6; i++) {
    const x = a[i];
    const y = b[i];
    const boxOk = x && y && x.kind === y.kind && x.box.every((v, k) => Math.abs(v - y.box[k]) <= 1);
    if (boxOk && x.text === y.text) continue;
    if (boxOk && ignoreDates && x.text.replace(DATE_RE, 'D') === y.text.replace(DATE_RE, 'D')) {
      dates.push(`${x.text} → ${y.text}`);
      continue;
    }
    diffs.push(`#${i}\n        old: ${fmt(x)}\n        new: ${fmt(y)}`);
  }
  return { same: !diffs.length, count: n, diffs, dates };
}

/* ---------------- scenario ---------------- */

console.log(`\nadmin e2e — ${BUILT ? 'built dist/index.html' : 'dev server'} at ${appUrl}\n`);

await test('old admin token is picked up after unlock', async () => {
  await page.goto(appUrl);
  await page.evaluate(async ({ user, repo, pw }) => {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('gh-token-salt-v1'), iterations: 200000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('github_pat_e2e_mock'));
    const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
    localStorage.clear();
    localStorage.setItem('gh_user', user);
    localStorage.setItem('gh_repo', repo);
    localStorage.setItem('gh_token_enc', b64(iv) + ':' + b64(ct));
    await new Promise(r => { const q = indexedDB.deleteDatabase('devlog-admin'); q.onsuccess = q.onerror = q.onblocked = r; });
  }, { user: USER, repo: REPO, pw: PASSWORD });
  await page.reload();
  await page.waitForSelector('input[type=password]');
  await page.waitForTimeout(300);
  await page.fill('input[type=password]', 'wrong-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('.lock-err');
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => window.__devlogShell.store.get().editorReady, null, { timeout: 60000 });
  const gh = await shell(() => ({ token: window.__devlogShell.token, gh: window.__devlogShell.store.get().gh }));
  assert(gh.token === 'github_pat_e2e_mock', 'token not decrypted: ' + gh.token);
  assert(gh.gh.hasToken && gh.gh.user === USER, 'gh info wrong');
});

let docs = [];
await test('first sync imports every published page from the repo', async () => {
  await page.waitForFunction(() => window.__devlogShell.store.get().sync.state === 'idle', null, { timeout: 30000 });
  docs = await shell(() => window.__devlogShell.data.allDocs().map(d => ({ id: d.id, kind: d.kind, title: d.meta.title, status: window.__devlogShell.data.status(d.id) })));
  const counts = docs.reduce((m, d) => ({ ...m, [d.kind]: (m[d.kind] || 0) + 1 }), {});
  assert(docs.length > 30, 'too few docs: ' + docs.length);
  const notPublished = docs.filter(d => d.status !== 'published');
  assert(!notPublished.length, 'not published after import: ' + notPublished.map(d => d.title).join(', '));
  assert(!repo.log.some(l => /^(POST|PATCH)/.test(l)), 'wrote to the repo during sync');
  return JSON.stringify(counts);
});

await test('editor matches the published page for every post, work and the about page', async () => {
  const sample = docs.filter(d => d.kind !== 'galleryItem').concat(docs.filter(d => d.kind === 'galleryItem').slice(0, 3));
  const bad = [];
  for (const d of sample) {
    await openDoc(d.id);
    await page.click('.topbar button:has-text("预览")');
    await page.waitForSelector('.preview-frame');
    await page.waitForTimeout(800);
    await page.click('.dialog button:has-text("排版一致性检查")');
    await page.waitForSelector('.check-result', { timeout: 30000 });
    const text = (await page.textContent('.check-result')).trim();
    if (!text.startsWith('一致')) bad.push(`${d.title}: ${text.slice(0, 200)}`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.preview-frame', { state: 'detached' });
  }
  assert(!bad.length, bad.join('\n'));
  return `${sample.length} pages`;
});

let editedPost = null;
await test('publishing an edit writes one commit with the page, lists and content files', async () => {
  editedPost = docs.find(d => d.kind === 'post');
  await openDoc(editedPost.id);
  await editor(`app.editor.chain().focus('end').insertContent({ type: 'paragraph', content: [{ type: 'text', text: 'E2E 追加的一段话。' }] }).run();`);
  await page.waitForTimeout(1200);
  assert(await statusOf(editedPost.id) === 'modified', 'status did not become modified');
  const before = await clickPublish();
  assert(repo.head !== before, 'no commit was made');
  const changes = repo.diff(before);
  const paths = changes.map(c => c.path);
  const docFiles = paths.filter(p => p.startsWith('content/docs/'));
  assert(paths.includes('content/index.json'), 'content/index.json missing');
  assert(docFiles.length === docs.length, `expected ${docs.length} doc files on first publish, got ${docFiles.length}`);
  const pub = JSON.parse(repo.text('content/index.json'));
  const pagePath = pub.posts.find(p => p.id === editedPost.id).path;
  assert(paths.includes(pagePath), 'post page not updated: ' + pagePath);
  assert(repo.text(pagePath).includes('E2E 追加的一段话。'), 'published page lacks the new text');
  assert(await statusOf(editedPost.id) === 'published', 'status not published after publish');
  assert(repo.commits.get(repo.head).message.startsWith('publish: '), 'commit message: ' + repo.commits.get(repo.head).message);
  const other = changes.filter(c => !c.path.startsWith('content/') && c.path !== pagePath).map(c => `${c.type} ${c.path}`);
  return `${changes.length} files; besides content/ and the page: ${other.join(', ') || 'none'}`;
});

await test('list pages and the homepage look the same after the first publish', async () => {
  const pubPath = JSON.parse(repo.text('content/index.json')).posts.find(p => p.id === editedPost.id).path;
  const changed = repo.diff(startCommit).filter(c => c.type === 'M' && c.path.endsWith('.html') && c.path !== pubPath).map(c => c.path);
  const bad = [];
  const dates = [];
  for (const p of changed) {
    for (const width of [1440, 390]) {
      const r = compareLayouts(await layoutOf(`https://old.site.test/${p}`, width), await layoutOf(`https://new.site.test/${p}`, width), { ignoreDates: true });
      if (width === 1440) dates.push(...r.dates.map(d => `${p}: ${d}`));
      if (!r.same) { bad.push(`${p} @${width}px\n      ${r.diffs.join('\n      ')}`); break; }
    }
  }
  assert(!bad.length, bad.join('\n    '));
  return `${changed.length} html files at 1440px and 390px${dates.length ? `; dates now taken from the article pages:\n      ${dates.join('\n      ')}` : ''}`;
});

await test('the admin notices when GitHub Pages serves the new version', async () => {
  await page.waitForFunction(() => { const d = window.__devlogShell.store.get().deploy; return d && d.state === 'live'; }, null, { timeout: 20000 });
});

let newPost = null;
await test('a new post with an uploaded image is published with the image in the same commit', async () => {
  await page.evaluate(() => window.__devlogShell.createDoc('post'));
  await page.waitForTimeout(800);
  await page.keyboard.type('E2E 新文章');
  await page.keyboard.press('Enter');
  await page.keyboard.type('新文章的第一段。');
  const img = [...repo.initialTree.keys()].find(p => /^images\/.+\.(png|jpe?g)$/i.test(p) && repo.file(p, repo.initialTree).length > 30000);
  const local = path.join(OUT, 'upload' + path.extname(img));
  fs.writeFileSync(local, repo.file(img, repo.initialTree));
  fileQueue.push(local);
  await page.keyboard.press('Enter');
  await editor(`app.pickImages(null);`);
  await page.waitForFunction(() => JSON.stringify(document.querySelector('iframe.canvas-frame').contentWindow.__devlogEditor.editor.getJSON()).includes('"figure"'), null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  newPost = await shell(() => window.__devlogShell.store.get().currentId);
  const src = await editor(`return JSON.stringify(app.editor.getJSON()).match(/"src":"([^"]+)"/)[1];`);
  const before = await clickPublish();
  const changes = repo.diff(before).map(c => c.path);
  const imgPath = changes.find(p => p.startsWith('images/'));
  assert(imgPath && src.endsWith(imgPath), `image not committed (src ${src}, changes ${changes.join(', ')})`);
  const pub = JSON.parse(repo.text('content/index.json'));
  const meta = pub.posts.find(p => p.id === newPost);
  assert(meta, 'new post not in index');
  assert(repo.text(meta.path).includes('新文章的第一段。'), 'page text missing');
  assert(repo.text('blog/index.html').includes('E2E 新文章'), 'blog list lacks the new post');
  const home = repo.text('index.html');
  return `page ${meta.path}; homepage ${home.includes('E2E 新文章') ? 'lists it' : 'unchanged'}`;
});

await test('changing the link leaves a redirect at the old address', async () => {
  const oldPath = JSON.parse(repo.text('content/index.json')).posts.find(p => p.id === newPost).path;
  await page.evaluate(id => window.__devlogShell.data.updateMeta(id, { slug: 'e2e-renamed' }), newPost);
  await page.waitForTimeout(500);
  const before = await clickPublish();
  const pub = JSON.parse(repo.text('content/index.json'));
  const newPath = pub.posts.find(p => p.id === newPost).path;
  assert(newPath !== oldPath && newPath.includes('e2e-renamed'), 'path did not change: ' + newPath);
  assert(repo.text(newPath), 'new page missing');
  const redirect = repo.text(oldPath);
  assert(redirect && /http-equiv="refresh"|location\.replace/i.test(redirect), 'old path is not a redirect');
  return `${oldPath} → ${newPath} (${repo.diff(before).length} files)`;
});

await test('publishing survives a push made elsewhere in the meantime', async () => {
  await openDoc(editedPost.id);
  await editor(`app.editor.chain().focus('end').insertContent({ type: 'paragraph', content: [{ type: 'text', text: '第二次修改。' }] }).run();`);
  await page.waitForTimeout(1200);
  repo.beforeRefUpdate = () => repo.pushExternal('notes/external.txt', 'pushed from elsewhere\n', 'external change');
  const before = await clickPublish();
  const tree = repo.headTree();
  assert(tree.has('notes/external.txt'), 'the external change was lost');
  assert(repo.text(JSON.parse(repo.text('content/index.json')).posts.find(p => p.id === editedPost.id).path).includes('第二次修改。'), 'edit not published');
  const patches = repo.log.filter(l => l.startsWith('PATCH')).length;
  return `ref updates attempted: ${patches}, head moved from ${before.slice(0, 7)}`;
});

await test('unpublishing removes the page and its list entry', async () => {
  const pub0 = JSON.parse(repo.text('content/index.json'));
  const p = pub0.posts.find(x => x.id === newPost).path;
  await page.evaluate(id => window.__devlogShell.publish({ unpublishIds: [id], label: '撤下页面' }), newPost);
  await waitIdle();
  const pub = JSON.parse(repo.text('content/index.json'));
  assert(!pub.posts.some(x => x.id === newPost), 'still in index');
  assert(!repo.headTree().has(p), 'page still exists');
  assert(!repo.headTree().has(`content/docs/${newPost}.json`), 'doc json still exists');
  assert(!repo.text('blog/index.html').includes('E2E 新文章'), 'still listed');
  assert(await statusOf(newPost) === 'new', 'local draft should remain as unpublished');
});

// Pages whose live HTML carries styling the editor doesn't keep (Word paste, <font> faces,
// fixed table row heights, wrapper divs left open), so republishing them changes how they look.
const NORMALIZED_PAGES = new Set([
  'about/index.html',
  'blog/地牢猎人-dungeon-hunters-核心玩法循环拆解.html',
  'blog/杀戮尖塔-slay-the-spire-核心玩法循环拆解.html',
  'works/烬明-emberlight.html',
]);

await test('rebuilding every page keeps the whole site looking the same', async () => {
  await page.evaluate(() => window.__devlogShell.publish({ rebuildAll: true, label: '重新生成' }));
  await waitIdle();
  const pages = [...repo.initialTree.keys()].filter(p => p.endsWith('.html') && !p.startsWith('admin') && repo.headTree().has(p));
  const changed = pages.filter(p => repo.initialTree.get(p) !== repo.headTree().get(p));
  const bad = [];
  const expected = [];
  for (const p of changed) {
    if (editedPost && repo.text(p).includes('E2E 追加的一段话。')) continue;
    for (const width of [1440, 390]) {
      const r = compareLayouts(await layoutOf(`https://old.site.test/${p}`, width), await layoutOf(`https://new.site.test/${p}`, width), { ignoreDates: true });
      if (r.same) continue;
      (NORMALIZED_PAGES.has(p) ? expected : bad).push(`${p} @${width}px\n      ${r.diffs.join('\n      ')}`);
      break;
    }
  }
  fs.writeFileSync(path.join(OUT, 'rebuild-diffs.txt'), [...bad, ...expected.map(e => `(expected) ${e}`)].join('\n\n'));
  assert(!bad.length, `${bad.length} of ${changed.length} rebuilt pages differ (see .tmp/e2e/rebuild-diffs.txt):\n    ${bad.slice(0, 3).join('\n    ')}`);
  return `${changed.length} rebuilt pages compared at 1440px and 390px; ${expected.length} differ as expected: ${expected.map(e => e.split(' @')[0]).join(', ')}`;
});

await test('no errors in the console', async () => {
  // The 422 comes from the simulated concurrent push above.
  const real = errors.filter(e => !/favicon|fonts\.g(oogleapis|static)|ERR_INTERNET_DISCONNECTED|status of 422/.test(e));
  assert(!real.length, real.slice(0, 8).join('\n'));
});

await browser.close();
if (BUILT) server.close(); else await server.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed\n`);
if (!args.includes('--keep') && !failed) fs.rmSync(OUT, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
