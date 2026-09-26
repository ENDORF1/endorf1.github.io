import { createStore } from '../editor/store.js';
import { Data, KIND_LABEL } from './data.js';
import { GitHub } from './github.js';
import { ImageStore } from './images.js';
import { Remote, publishChanges } from './remote.js';
import { checkPassword, loadToken, saveToken, sha256Hex } from './crypto.js';
import { requestPersistence } from './db.js';
import { createCanvas } from './canvas.js';
import { SITE_CSS } from './assets.js';

const DEPLOY_POLL_MS = 5000;
const DEPLOY_TIMEOUT_MS = 6 * 60 * 1000;

let toastSeq = 0;

export class Shell {
  constructor() {
    const saved = JSON.parse(localStorage.getItem('devlog_admin_ui') || '{}');
    this.store = createStore({
      phase: 'lock', bootMsg: '', bootError: null, rev: 0,
      currentId: null, sidebar: saved.sidebar !== false, panel: saved.panel !== false, panelTab: saved.panelTab || 'page',
      device: saved.device || 'auto', stats: {}, savedAt: null,
      sync: { state: 'idle', error: null, at: null }, publishing: null, deploy: null,
      dialog: null, toasts: [], editorReady: false, conflicts: [], gh: this.ghInfo(false), search: '',
    });
    this.password = null;
    this.token = null;
    this.gh = new GitHub({});
    this.remote = new Remote(this.gh);
    this.images = new ImageStore(() => ({ user: this.gh.user || localStorage.getItem('gh_user') || '', repo: this.gh.repo || localStorage.getItem('gh_repo') || '' }));
    this.data = new Data({ onChange: () => this.bump() });
    this.data.remote = this.remote;
    this.api = null;
    this.canvas = null;
    this.scrollMemory = new Map();
    this.pickResolver = null;
    window.addEventListener('beforeunload', e => {
      this.data.flush();
      if (this.store.get().publishing) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushAll();
    });
  }

  ghInfo(hasToken) {
    return { user: localStorage.getItem('gh_user') || '', repo: localStorage.getItem('gh_repo') || '', hasToken };
  }

  bump() {
    this.store.set(s => ({ rev: s.rev + 1 }));
  }

  persistUI() {
    const s = this.store.get();
    localStorage.setItem('devlog_admin_ui', JSON.stringify({ sidebar: s.sidebar, panel: s.panel, panelTab: s.panelTab, device: s.device, last: s.currentId }));
  }

  setUI(patch) {
    this.store.set(patch);
    this.persistUI();
  }

  toast(text, type = 'info', opts = {}) {
    const id = ++toastSeq;
    const t = { id, text, type, action: opts.action || null };
    this.store.set(s => ({ toasts: [...s.toasts.slice(-3), t] }));
    setTimeout(() => this.dismissToast(id), opts.duration || (type === 'error' ? 6000 : 3000));
    return id;
  }

  dismissToast(id) {
    this.store.set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
  }

  /* ---------------- unlock & boot ---------------- */

  async unlock(pw) {
    if (!(await checkPassword(pw))) return false;
    this.password = pw;
    if (!localStorage.getItem('_pw_hash')) localStorage.setItem('_pw_hash', await sha256Hex(pw));
    this.store.set({ phase: 'boot', bootMsg: '正在读取本地草稿…' });
    try {
      await this.boot();
    } catch (err) {
      console.error(err);
      this.store.set({ phase: 'error', bootError: err.message || String(err) });
    }
    return true;
  }

  async boot() {
    requestPersistence();
    this.token = await loadToken(this.password);
    this.configureGitHub();
    await this.data.load();
    await this.images.init();
    this.images.prune();
    if (this.data.isEmpty()) {
      this.store.set({ bootMsg: '正在读取已发布的内容…' });
      await this.sync({ initial: true });
    } else {
      this.sync({ quiet: true });
    }
    const last = JSON.parse(localStorage.getItem('devlog_admin_ui') || '{}').last;
    const first = (last && this.data.find(last) && last) || (this.data.allDocs()[0] || {}).id || null;
    this.store.set({ phase: 'ready', currentId: first });
    this.bump();
  }

  configureGitHub() {
    this.gh.user = localStorage.getItem('gh_user') || '';
    this.gh.repo = localStorage.getItem('gh_repo') || '';
    this.gh.token = this.token || '';
    this.store.set({ gh: this.ghInfo(!!this.token) });
  }

  async saveGitHub({ user, repo, token }) {
    localStorage.setItem('gh_user', user.trim());
    localStorage.setItem('gh_repo', repo.trim());
    if (token !== undefined) {
      this.token = token.trim() || null;
      await saveToken(this.token, this.password);
      localStorage.removeItem('gh_token');
    }
    this.configureGitHub();
  }

  async testGitHub() {
    if (!this.gh.ready) throw new Error('请先填写用户名、仓库和令牌');
    const info = await this.gh.checkAccess();
    return info;
  }

  /* ---------------- remote sync ---------------- */

  async sync({ initial = false, quiet = false, force = false } = {}) {
    const onProgress = msg => { if (initial) this.store.set({ bootMsg: msg }); };
    this.store.set({ sync: { ...this.store.get().sync, state: 'syncing', error: null } });
    try {
      const res = await this.remote.fetchPublished({ knownCommit: force ? null : this.data.pubCommit, onProgress });
      if (res.offline) {
        this.store.set({ sync: { state: 'offline', error: null, at: Date.now() } });
        if (initial && this.data.isEmpty()) this.toast('没有读到已发布的内容。可以在设置里连接 GitHub 后重试', 'warn', { duration: 8000 });
        return;
      }
      if (!res.upToDate && res.pub) {
        const { conflicts, added } = await this.data.reconcile(res.pub, res.commit, res.importedBodies || null);
        this.store.set(s => ({ conflicts: [...new Set([...s.conflicts, ...conflicts])] }));
        if (!initial && added.length) this.toast(`从线上同步了 ${added.length} 篇文档`, 'info');
        if (conflicts.length) this.toast(`${conflicts.length} 篇文档在其他地方发布过新版本，本地修改已保留`, 'warn', { duration: 8000 });
        if (res.report && res.report.length) console.warn(res.report);
        if (!initial && this.api && this.store.get().currentId) {
          const id = this.store.get().currentId;
          if (!this.data.hasLocalBody(id) && added.indexOf(id) < 0) this.openDoc(id, { force: true, keepScroll: true });
        }
      }
      this.store.set({ sync: { state: 'idle', error: null, at: Date.now() } });
    } catch (err) {
      console.error(err);
      this.store.set({ sync: { state: 'error', error: err.message || String(err), at: Date.now() } });
      if (!quiet) this.toast('同步失败：' + (err.message || err), 'error');
    }
  }

  /* ---------------- editor canvas ---------------- */

  mountCanvas(container) {
    if (this.canvas) return;
    window.__devlogHost = this.hostApi();
    this.canvas = createCanvas(container);
  }

  hostApi() {
    const shell = this;
    return {
      attach(api) {
        shell.api = api;
        shell.store.set({ editorReady: true });
        const id = shell.store.get().currentId;
        if (id) shell.openDoc(id, { force: true });
      },
      metaChanged(docId, patch) {
        const before = shell.data.find(docId);
        const prevSlug = before && before.meta.slug;
        const next = shell.data.updateMeta(docId, patch);
        shell.store.set({ savedAt: Date.now() });
        if (next && 'catId' in patch) shell.pushMeta(docId);
        if (next && prevSlug !== next.slug) shell.bump();
      },
      bodyChanged(docId, json) {
        shell.data.setBody(docId, json);
        shell.store.set({ savedAt: Date.now() });
      },
      statsChanged(docId, stats) {
        shell.store.set(s => ({ stats: { ...s.stats, [docId]: stats } }));
      },
      shortcut(name) {
        if (name === 'save') shell.saveNow();
        else if (name === 'preview') shell.openDialog({ type: 'preview' });
        else if (name === 'toggleSidebar') shell.setUI({ sidebar: !shell.store.get().sidebar });
        else if (name === 'help') shell.openDialog({ type: 'help' });
      },
      openExternal(url) {
        if (!url) return;
        window.open(url, '_blank', 'noopener');
      },
      toast: (text, type) => shell.toast(text, type),
      displaySrc: src => shell.images.displaySrc(src),
      isOwnImage: src => shell.images.isOwn(src),
      pickImage: opts => shell.pickImage(opts),
      async processImages(files, purpose) {
        const out = [];
        for (const f of files) {
          const r = await shell.images.process(f, purpose);
          out.push({ src: r.src, full: r.full, naturalWidth: r.width || null, naturalHeight: r.height || null });
        }
        return out;
      },
      async adoptImage(src) {
        return { src: await shell.images.adopt(src) };
      },
      suggestions: kind => shell.data.suggestions(kind),
      galleryCategories: () => shell.data.ws.gallery.map(c => ({ id: c.id, name: c.name })),
      moveGalleryItem(docId, catId) {
        shell.data.moveGalleryItem(docId, catId);
        shell.pushMeta(docId);
      },
      pageUrl: docId => {
        const path = shell.data.pageUrl(docId);
        return path ? shell.siteOrigin() + path : null;
      },
    };
  }

  siteOrigin() {
    if (/\.github\.io$/i.test(location.hostname)) return location.origin;
    const user = this.gh.user || localStorage.getItem('gh_user');
    return user ? `https://${user.toLowerCase()}.github.io` : location.origin;
  }

  liveUrl(id) {
    const path = this.data.pageUrl(id);
    return path ? this.siteOrigin() + path : null;
  }

  pushMeta(id) {
    const found = this.data.find(id);
    if (!found || !this.api || this.store.get().currentId !== id) return;
    this.api.setMeta(this.data.fullMeta(found), found.cat ? { id: found.cat.id, slug: found.cat.slug, name: found.cat.name } : null);
  }

  async openDoc(id, { force = false, focus = null, keepScroll = false } = {}) {
    const cur = this.store.get().currentId;
    if (this.api && cur && cur !== id) {
      this.api.flush();
      this.scrollMemory.set(cur, this.api.scrollTop());
    }
    if (cur === id && !force) return;
    this.store.set({ currentId: id });
    this.persistUI();
    if (!this.api) return;
    const found = this.data.find(id);
    if (!found) { this.api.unload(); return; }
    let body;
    try {
      body = await this.data.getBody(id);
    } catch (err) {
      this.toast(err.message || String(err), 'error');
      return;
    }
    if (this.store.get().currentId !== id) return;
    const scrollTop = keepScroll ? this.api.scrollTop() : (this.scrollMemory.get(id) || 0);
    this.api.load({
      docId: id, kind: found.kind, meta: this.data.fullMeta(found),
      cat: found.cat ? { id: found.cat.id, slug: found.cat.slug, name: found.cat.name } : null,
      body, readOnly: false, focus, scrollTop,
    });
    this.data.snapshot(id, 'open', body).catch(() => {});
  }

  async createDoc(kind, opts = {}) {
    try {
      const id = this.data.createDoc(kind, opts);
      await this.openDoc(id, { focus: 'title' });
      return id;
    } catch (err) {
      this.toast(err.message || String(err), 'error');
      return null;
    }
  }

  async duplicateDoc(id) {
    const newId = await this.data.duplicateDoc(id);
    if (newId) { await this.openDoc(newId, { focus: 'title' }); this.toast('已创建副本', 'success'); }
  }

  trashDoc(id) {
    const found = this.data.find(id);
    if (!found) return;
    const wasPublished = !!this.data.pubOf(id);
    const list = this.data.allDocs();
    const idx = list.findIndex(d => d.id === id);
    this.data.moveToTrash(id);
    if (this.store.get().currentId === id) {
      const rest = this.data.allDocs();
      const next = rest[Math.min(idx, rest.length - 1)];
      if (next) this.openDoc(next.id); else { this.store.set({ currentId: null }); if (this.api) this.api.unload(); }
    }
    this.toast(wasPublished ? '已移到回收站。网页仍在线，下次发布时会撤下' : '已移到回收站', 'info', {
      duration: 6000,
      action: { label: '撤销', run: () => { this.data.restoreFromTrash(id); this.openDoc(id); } },
    });
  }

  saveNow() {
    this.flushAll();
    this.toast('草稿已保存在本机，发布后才会出现在网站上', 'success');
  }

  flushAll() {
    if (this.api) this.api.flush();
    this.data.flush();
  }

  setDevice(device) {
    this.setUI({ device });
  }

  /* ---------------- images ---------------- */

  pickImage({ multiple = false } = {}) {
    return new Promise(resolve => {
      if (this.pickResolver) this.pickResolver(null);
      this.pickResolver = resolve;
      this.openDialog({ type: 'library', pick: true, multiple });
    });
  }

  resolvePick(result) {
    const r = this.pickResolver;
    this.pickResolver = null;
    if (r) r(result);
  }

  /* ---------------- dialogs ---------------- */

  openDialog(dialog) {
    if (this.api) this.api.flush();
    this.store.set({ dialog });
  }

  closeDialog() {
    const d = this.store.get().dialog;
    if (d && d.type === 'library' && d.pick) this.resolvePick(null);
    if (d && d.resolve) d.resolve(null);
    this.store.set({ dialog: null });
  }

  confirm({ title, text, ok = '确定', danger = false }) {
    return new Promise(resolve => {
      this.store.set({ dialog: { type: 'confirm', title, text, ok, danger, resolve } });
    });
  }

  prompt({ title, label, value = '', ok = '确定', fields = null }) {
    return new Promise(resolve => {
      this.store.set({ dialog: { type: 'prompt', title, label, value, ok, fields, resolve } });
    });
  }

  answer(value) {
    const d = this.store.get().dialog;
    this.store.set({ dialog: null });
    if (d && d.resolve) d.resolve(value);
  }

  /* ---------------- publishing ---------------- */

  requireGitHub() {
    if (this.gh.ready) return true;
    this.toast('发布需要先连接 GitHub', 'warn');
    this.openDialog({ type: 'settings', section: 'github' });
    return false;
  }

  async publish({ ids = [], unpublishIds = [], rebuildAll = false, label = '发布' } = {}) {
    if (!this.requireGitHub()) return null;
    if (this.store.get().publishing) return null;
    this.flushAll();
    const log = [];
    const progress = msg => {
      log.push(msg);
      this.store.set({ publishing: { label, progress: [...log] } });
    };
    progress('准备发布…');
    for (const id of ids) await this.data.snapshot(id, 'publish').catch(() => {});
    try {
      const res = await publishChanges({ data: this.data, gh: this.gh, images: this.images, css: SITE_CSS, ids, unpublishIds, rebuildAll, onProgress: progress });
      this.store.set(s => ({ publishing: null, conflicts: s.conflicts.filter(id => !ids.includes(id)) }));
      if (res.noop) {
        this.toast('线上已经是最新内容，没有需要提交的变化', 'info');
      } else {
        for (const w of res.warnings) this.toast(w, 'warn', { duration: 8000 });
        this.watchDeploy(res.next.rev, ids[0] || null);
      }
      for (const id of unpublishIds) {
        const t = this.data.ws.trash.find(x => x.id === id);
        if (t) await this.data.deleteForever(id);
      }
      this.bump();
      return res;
    } catch (err) {
      console.error(err);
      this.store.set({ publishing: null });
      this.toast('发布失败：' + (err.message || err), 'error', { duration: 10000 });
      return null;
    }
  }

  publishCurrent() {
    const id = this.store.get().currentId;
    if (!id) return;
    const s = this.data.status(id);
    if (s === 'published') { this.toast('这篇文档已经是线上最新版本', 'info'); return; }
    const title = this.data.find(id).meta.title || '无标题';
    return this.publish({ ids: [id], label: `发布「${title}」` });
  }

  async unpublishDoc(id) {
    const found = this.data.find(id);
    if (!found || !this.data.pubOf(id)) return;
    const ok = await this.confirm({
      title: '从网站撤下这个页面？',
      text: `「${found.meta.title || '无标题'}」会从网站和列表页移除，本地草稿保留，之后可以重新发布。`,
      ok: '撤下', danger: true,
    });
    if (!ok) return;
    await this.publish({ unpublishIds: [id], label: '撤下页面' });
  }

  watchDeploy(rev, docId) {
    const url = docId ? this.liveUrl(docId) : this.siteOrigin() + '/';
    const started = Date.now();
    const deploy = { rev, url, state: 'waiting', startedAt: started };
    this.store.set({ deploy });
    const tick = async () => {
      const cur = this.store.get().deploy;
      if (!cur || cur.rev !== rev) return;
      try {
        const res = await fetch(`${this.siteOrigin()}/content/index.json?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
          const live = await res.json();
          if ((live.rev || 0) >= rev) {
            this.store.set({ deploy: { ...cur, state: 'live', liveAt: Date.now() } });
            this.toast('网站已更新', 'success', { action: url ? { label: '查看', run: () => window.open(url, '_blank', 'noopener') } : null, duration: 6000 });
            setTimeout(() => { if (this.store.get().deploy && this.store.get().deploy.rev === rev) this.store.set({ deploy: null }); }, 20000);
            return;
          }
        }
      } catch { /* keep polling */ }
      if (Date.now() - started > DEPLOY_TIMEOUT_MS) {
        this.store.set({ deploy: { ...cur, state: 'timeout' } });
        return;
      }
      setTimeout(tick, DEPLOY_POLL_MS);
    };
    setTimeout(tick, DEPLOY_POLL_MS);
  }

  kindLabel(kind) { return KIND_LABEL[kind] || ''; }
}
