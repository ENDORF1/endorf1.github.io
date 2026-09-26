import { db } from './db.js';
import { contentHash, pageFields, emptyPub, findPub, CONTENT_INDEX, docFilePath } from '../shared/site.js';
import { PATHS, pageUrl } from '../shared/templates.js';
import { uid, slugify, cleanSlug, todayISO, normLayout, debounce } from '../shared/util.js';

export const KIND_LABEL = { post: '文章', work: '项目', galleryItem: '画廊作品', about: '关于我' };
export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

const HISTORY_KEEP = 60;
const AUTO_SNAPSHOT_MS = 5 * 60 * 1000;
const TRASH_DAYS = 30;

export function emptyWorkspace() {
  return { format: 2, posts: [], works: [], gallery: [], about: null, trash: [] };
}

function sameFields(kind, a, b) {
  return JSON.stringify(pageFields(kind, a)) === JSON.stringify(pageFields(kind, b));
}

function fromPub(kind, p) {
  const out = { ...pageFields(kind, p), slugLocked: true, createdAt: Date.parse(p.publishedAt) || Date.now(), updatedAt: Date.parse(p.publishedAt) || Date.now() };
  delete out.catId;
  return out;
}

function flattenPub(pub) {
  const out = [];
  if (!pub) return out;
  for (const p of pub.posts) out.push({ kind: 'post', meta: p });
  for (const w of pub.works) out.push({ kind: 'work', meta: w });
  for (const c of pub.gallery) for (const i of c.items) out.push({ kind: 'galleryItem', meta: { ...i, catId: i.catId || c.id }, cat: c });
  if (pub.about) out.push({ kind: 'about', meta: pub.about });
  return out;
}

/**
 * Local drafts plus the last known published state. Drafts live in IndexedDB so
 * nothing is lost on reload; the published layer mirrors content/index.json.
 */
export class Data {
  constructor({ onChange }) {
    this.ws = emptyWorkspace();
    this.pub = null;
    this.pubCommit = null;
    this.drafts = new Map();
    this.pubBodies = new Map();
    this.statusCache = new Map();
    this.onChange = onChange;
    this.remote = null;
    this.lastSnapshot = new Map();
    this.saveWs = debounce(() => db.put('kv', 'ws', this.ws), 150);
    this.pendingBodies = new Map();
    this.saveBodies = debounce(() => this.flushBodies(), 200);
  }

  /* ---------------- persistence ---------------- */

  async load() {
    const [ws, pub, pubCommit] = await Promise.all([db.get('kv', 'ws'), db.get('kv', 'pub'), db.get('kv', 'pubCommit')]);
    this.ws = ws && ws.format === 2 ? { ...emptyWorkspace(), ...ws } : emptyWorkspace();
    this.pub = pub || null;
    this.pubCommit = pubCommit || null;
    const keys = await db.keys('bodies');
    const draftKeys = keys.filter(k => String(k).startsWith('draft:'));
    for (const k of draftKeys) {
      const body = await db.get('bodies', k);
      if (body) this.drafts.set(k.slice(6), body);
    }
    this.purgeTrash();
  }

  async flushBodies() {
    const entries = [...this.pendingBodies.entries()].map(([id, body]) => [`draft:${id}`, body === null ? undefined : body]);
    this.pendingBodies.clear();
    if (entries.length) await db.putMany('bodies', entries);
  }

  async flush() {
    this.saveWs.flush();
    this.saveBodies.cancel();
    await this.flushBodies();
  }

  changed(ids) {
    if (ids) for (const id of ids) this.statusCache.delete(id);
    else this.statusCache.clear();
    this.saveWs();
    this.onChange();
  }

  isEmpty() {
    const w = this.ws;
    return !w.posts.length && !w.works.length && !w.gallery.length && !w.about;
  }

  /* ---------------- lookup ---------------- */

  find(id) {
    const w = this.ws;
    for (const p of w.posts) if (p.id === id) return { kind: 'post', meta: p, list: w.posts };
    for (const x of w.works) if (x.id === id) return { kind: 'work', meta: x, list: w.works };
    for (const c of w.gallery) for (const i of c.items) if (i.id === id) return { kind: 'galleryItem', meta: i, cat: c, list: c.items };
    if (w.about && w.about.id === id) return { kind: 'about', meta: w.about };
    return null;
  }

  /** Meta as the page templates and hashing see it (gallery items carry their category id). */
  fullMeta(found) {
    return found.kind === 'galleryItem' ? { ...found.meta, catId: found.cat.id } : found.meta;
  }

  allDocs() {
    const out = [];
    const w = this.ws;
    for (const p of w.posts) out.push({ id: p.id, kind: 'post', meta: p });
    for (const x of w.works) out.push({ id: x.id, kind: 'work', meta: x });
    for (const c of w.gallery) for (const i of c.items) out.push({ id: i.id, kind: 'galleryItem', meta: i, cat: c });
    if (w.about) out.push({ id: w.about.id, kind: 'about', meta: w.about });
    return out;
  }

  pubOf(id) {
    return this.pub ? findPub(this.pub, id) : null;
  }

  /** 'new' | 'published' | 'modified' */
  status(id) {
    const found = this.find(id);
    if (!found) return null;
    const p = this.pubOf(id);
    if (!p) return 'new';
    const body = this.drafts.get(id);
    const c = this.statusCache.get(id);
    if (c && c.meta === found.meta && c.body === body && c.pub === p.meta && c.cat === found.cat) return c.status;
    const meta = this.fullMeta(found);
    let status;
    if (body) status = contentHash(found.kind, meta, body) === p.meta.hash ? 'published' : 'modified';
    else status = sameFields(found.kind, meta, p.meta) ? 'published' : 'modified';
    if (status === 'published' && found.kind === 'galleryItem' && p.cat) {
      if (p.cat.name !== found.cat.name || p.cat.slug !== found.cat.slug) status = 'modified';
    }
    this.statusCache.set(id, { meta: found.meta, body, pub: p.meta, cat: found.cat, status });
    return status;
  }

  /** Changes that a "publish all" would push. */
  pendingChanges() {
    const docs = [];
    for (const d of this.allDocs()) {
      const s = this.status(d.id);
      if (s === 'new' || s === 'modified') docs.push({ ...d, status: s });
    }
    const takedowns = this.ws.trash.filter(t => this.pubOf(t.id)).map(t => ({ ...t, status: 'deleted' }));
    const structure = [];
    if (this.pub) {
      const pubPosts = this.pub.posts.map(p => p.id);
      const localPosts = this.ws.posts.map(p => p.id).filter(id => pubPosts.includes(id));
      if (localPosts.join() !== pubPosts.filter(id => localPosts.includes(id)).join()) structure.push('文章顺序');
      const pubWorks = this.pub.works.map(p => p.id);
      const localWorks = this.ws.works.map(p => p.id).filter(id => pubWorks.includes(id));
      if (localWorks.join() !== pubWorks.filter(id => localWorks.includes(id)).join()) structure.push('项目顺序');
      const pubCats = this.pub.gallery.map(c => `${c.id}:${c.name}:${c.slug}`);
      const localCats = this.ws.gallery.filter(c => this.pub.gallery.some(pc => pc.id === c.id)).map(c => `${c.id}:${c.name}:${c.slug}`);
      if (pubCats.filter(x => localCats.some(l => l.split(':')[0] === x.split(':')[0])).join() !== localCats.join()) structure.push('画廊分类');
      const pubItemOrder = this.pub.gallery.flatMap(c => c.items.map(i => `${c.id}/${i.id}`));
      const localItemOrder = this.ws.gallery.flatMap(c => c.items.map(i => `${c.id}/${i.id}`)).filter(x => pubItemOrder.includes(x));
      if (pubItemOrder.filter(x => localItemOrder.includes(x)).join() !== localItemOrder.join()) structure.push('画廊作品顺序');
    }
    return { docs, takedowns, structure };
  }

  pageUrl(id) {
    const p = this.pubOf(id);
    if (!p) return null;
    return pageUrl(p.meta.path);
  }

  draftPath(id) {
    const found = this.find(id);
    if (!found) return null;
    if (found.kind === 'post') return PATHS.post(found.meta);
    if (found.kind === 'work') return PATHS.work(found.meta);
    if (found.kind === 'galleryItem') return PATHS.galleryItem(found.meta, found.cat);
    return PATHS.about();
  }

  suggestions(kind) {
    const tags = new Map();
    const cats = new Map();
    const add = (map, v) => { if (v) map.set(v, (map.get(v) || 0) + 1); };
    const list = kind === 'work' ? this.ws.works : this.ws.posts;
    for (const m of list) {
      for (const t of m.tags || []) add(tags, t);
      if (kind !== 'work') add(cats, m.cat);
    }
    const sorted = map => [...map.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    return { tags: sorted(tags), cats: sorted(cats) };
  }

  /* ---------------- bodies ---------------- */

  hasLocalBody(id) {
    return this.drafts.has(id);
  }

  async getBody(id) {
    if (this.drafts.has(id)) return this.drafts.get(id);
    if (this.pubOf(id)) {
      const b = await this.pubBody(id);
      if (b) return b;
      throw new Error('无法读取线上正文，请检查网络后重试');
    }
    return EMPTY_DOC;
  }

  async pubBody(id) {
    if (this.pubBodies.has(id)) return this.pubBodies.get(id);
    const cached = await db.get('bodies', `pub:${id}`);
    if (cached) { this.pubBodies.set(id, cached); return cached; }
    if (!this.remote) return null;
    const text = await this.remote.readDoc(id);
    if (!text) return null;
    const body = JSON.parse(text).doc;
    this.pubBodies.set(id, body);
    await db.put('bodies', `pub:${id}`, body);
    return body;
  }

  setBody(id, body) {
    const found = this.find(id);
    if (!found) return;
    this.drafts.set(id, body);
    found.meta.updatedAt = Date.now();
    this.pendingBodies.set(id, body);
    this.saveBodies();
    this.maybeSnapshot(id, body);
    this.changed([id]);
  }

  /* ---------------- meta ---------------- */

  uniqueSlug(kind, base, selfId, cat) {
    const taken = new Set();
    const list = kind === 'post' ? this.ws.posts : kind === 'work' ? this.ws.works : kind === 'galleryItem' ? (cat ? cat.items : []) : [];
    for (const m of list) if (m.id !== selfId) taken.add(m.slug);
    if (this.pub && kind !== 'galleryItem') {
      for (const m of kind === 'post' ? this.pub.posts : this.pub.works) if (m.id !== selfId) taken.add(m.slug);
    }
    taken.add('index');
    let slug = base || '无标题';
    let n = 2;
    while (taken.has(slug)) slug = `${base}-${n++}`;
    return slug;
  }

  updateMeta(id, patch) {
    const found = this.find(id);
    if (!found) return;
    const next = { ...found.meta, ...patch, updatedAt: Date.now() };
    if ('title' in patch && !found.meta.slugLocked && found.kind !== 'about') {
      next.slug = this.uniqueSlug(found.kind, slugify(patch.title) || '无标题', id, found.cat);
    }
    if ('slug' in patch) {
      next.slug = this.uniqueSlug(found.kind, cleanSlug(patch.slug) || found.meta.slug, id, found.cat);
      next.slugLocked = true;
    }
    if ('layout' in patch) next.layout = normLayout(patch.layout, found.kind);
    this.replaceMeta(found, next);
    this.changed([id]);
    return next;
  }

  replaceMeta(found, next) {
    if (found.kind === 'about') { this.ws.about = next; return; }
    const i = found.list.indexOf(found.meta);
    found.list[i] = next;
  }

  createDoc(kind, { catId = null, title = '' } = {}) {
    const now = Date.now();
    const base = { title, createdAt: now, updatedAt: now, slugLocked: false, layout: normLayout(null, kind) };
    let meta;
    if (kind === 'post') {
      meta = { ...base, id: uid('p'), cat: '', tags: [], date: todayISO(), cover: '', coverPos: '50% 50%' };
      meta.slug = this.uniqueSlug('post', slugify(title) || '无标题', meta.id);
      this.ws.posts.unshift(meta);
    } else if (kind === 'work') {
      meta = { ...base, id: uid('w'), tags: [], date: todayISO(), desc: '', cover: '', coverFull: '', coverPos: '50% 50%', play: '', link: '' };
      meta.slug = this.uniqueSlug('work', slugify(title) || '无标题', meta.id);
      this.ws.works.unshift(meta);
    } else if (kind === 'galleryItem') {
      const cat = this.ws.gallery.find(c => c.id === catId) || this.ws.gallery[0];
      if (!cat) throw new Error('请先新建一个画廊分类');
      meta = { ...base, id: uid('g'), desc: '', img: '', imgFull: '', imgPos: '50% 50%' };
      meta.slug = this.uniqueSlug('galleryItem', slugify(title) || '无标题', meta.id, cat);
      cat.items.unshift(meta);
    } else {
      meta = { ...base, id: 'about', title: title || '关于我', slugLocked: true };
      this.ws.about = meta;
    }
    this.drafts.set(meta.id, EMPTY_DOC);
    this.pendingBodies.set(meta.id, EMPTY_DOC);
    this.saveBodies();
    this.changed([meta.id]);
    return meta.id;
  }

  async duplicateDoc(id) {
    const found = this.find(id);
    if (!found || found.kind === 'about') return null;
    const body = JSON.parse(JSON.stringify(await this.getBody(id)));
    const now = Date.now();
    const { id: _i, slug: _s, slugLocked: _l, createdAt: _c, updatedAt: _u, ...rest } = found.meta;
    const prefix = found.kind === 'post' ? 'p' : found.kind === 'work' ? 'w' : 'g';
    const meta = { ...JSON.parse(JSON.stringify(rest)), id: uid(prefix), title: `${found.meta.title || '无标题'} 副本`, createdAt: now, updatedAt: now, slugLocked: false };
    meta.slug = this.uniqueSlug(found.kind, slugify(meta.title) || '无标题', meta.id, found.cat);
    found.list.splice(found.list.indexOf(found.meta) + 1, 0, meta);
    this.drafts.set(meta.id, body);
    this.pendingBodies.set(meta.id, body);
    this.saveBodies();
    this.changed([meta.id]);
    return meta.id;
  }

  moveToTrash(id) {
    const found = this.find(id);
    if (!found || found.kind === 'about') return;
    if (found.list) found.list.splice(found.list.indexOf(found.meta), 1);
    this.ws.trash.unshift({ id, kind: found.kind, meta: found.meta, catId: found.cat ? found.cat.id : null, deletedAt: Date.now() });
    this.changed([id]);
  }

  restoreFromTrash(id) {
    const i = this.ws.trash.findIndex(t => t.id === id);
    if (i < 0) return;
    const [t] = this.ws.trash.splice(i, 1);
    if (t.kind === 'post') this.ws.posts.unshift(t.meta);
    else if (t.kind === 'work') this.ws.works.unshift(t.meta);
    else if (t.kind === 'galleryItem') {
      let cat = this.ws.gallery.find(c => c.id === t.catId) || this.ws.gallery[0];
      if (!cat) { cat = { id: uid('c'), slug: 'restored', name: '恢复的作品', items: [] }; this.ws.gallery.push(cat); }
      cat.items.unshift(t.meta);
    }
    this.changed([id]);
  }

  async deleteForever(id) {
    this.ws.trash = this.ws.trash.filter(t => t.id !== id);
    this.drafts.delete(id);
    this.pendingBodies.set(id, null);
    await this.flushBodies();
    const snaps = await db.byIndex('history', 'doc', id);
    for (const s of snaps) await db.del('history', s.key);
    this.changed([id]);
  }

  purgeTrash() {
    const cutoff = Date.now() - TRASH_DAYS * 86400000;
    const old = this.ws.trash.filter(t => t.deletedAt < cutoff && !this.pubOf(t.id));
    for (const t of old) this.deleteForever(t.id);
  }

  reorder(kind, ids, catId = null) {
    const pick = (list) => {
      const byId = new Map(list.map(m => [m.id, m]));
      const out = ids.map(id => byId.get(id)).filter(Boolean);
      for (const m of list) if (!ids.includes(m.id)) out.push(m);
      return out;
    };
    if (kind === 'post') this.ws.posts = pick(this.ws.posts);
    else if (kind === 'work') this.ws.works = pick(this.ws.works);
    else if (kind === 'category') {
      const byId = new Map(this.ws.gallery.map(c => [c.id, c]));
      this.ws.gallery = ids.map(id => byId.get(id)).filter(Boolean);
    } else if (kind === 'galleryItem') {
      const cat = this.ws.gallery.find(c => c.id === catId);
      if (cat) cat.items = pick(cat.items);
    }
    this.changed();
  }

  moveGalleryItem(id, catId, index = 0) {
    const found = this.find(id);
    const target = this.ws.gallery.find(c => c.id === catId);
    if (!found || found.kind !== 'galleryItem' || !target) return;
    found.cat.items.splice(found.cat.items.indexOf(found.meta), 1);
    const meta = { ...found.meta, updatedAt: Date.now() };
    meta.slug = this.uniqueSlug('galleryItem', meta.slug, id, target);
    target.items.splice(Math.max(0, Math.min(index, target.items.length)), 0, meta);
    this.changed([id]);
  }

  /* ---------------- gallery categories ---------------- */

  createCategory(name, slug) {
    const s = cleanSlug(slug) || slugify(name) || 'category';
    let unique = s;
    let n = 2;
    while (this.ws.gallery.some(c => c.slug === unique)) unique = `${s}-${n++}`;
    const cat = { id: uid('c'), name: name || '新分类', slug: unique, items: [] };
    this.ws.gallery.push(cat);
    this.changed();
    return cat.id;
  }

  updateCategory(id, patch) {
    const i = this.ws.gallery.findIndex(c => c.id === id);
    if (i < 0) return;
    const next = { ...this.ws.gallery[i] };
    if (patch.name != null) next.name = patch.name.trim() || next.name;
    if (patch.slug != null) {
      const s = cleanSlug(patch.slug);
      if (s && !this.ws.gallery.some(c => c.id !== id && c.slug === s)) next.slug = s;
    }
    this.ws.gallery[i] = next;
    this.changed();
  }

  deleteCategory(id) {
    const cat = this.ws.gallery.find(c => c.id === id);
    if (!cat || cat.items.length) return false;
    this.ws.gallery = this.ws.gallery.filter(c => c.id !== id);
    this.changed();
    return true;
  }

  /* ---------------- history ---------------- */

  async snapshot(id, reason, body = null) {
    const found = this.find(id) || this.ws.trash.find(t => t.id === id);
    if (!found) return;
    const b = body || this.drafts.get(id) || (await this.pubBody(id).catch(() => null));
    if (!b) return;
    const ts = Date.now();
    const snap = { key: `${id}:${ts}`, docId: id, ts, reason, title: found.meta.title || '', meta: JSON.parse(JSON.stringify(found.meta)), body: b };
    const list = await db.byIndex('history', 'doc', id);
    list.sort((a, c) => c.ts - a.ts);
    const last = list[0];
    if (last && JSON.stringify(last.body) === JSON.stringify(b) && JSON.stringify(last.meta) === JSON.stringify(snap.meta) && reason === 'auto') return;
    await db.put('history', snap.key, snap);
    this.lastSnapshot.set(id, ts);
    for (const old of list.slice(HISTORY_KEEP - 1)) await db.del('history', old.key);
  }

  maybeSnapshot(id, body) {
    const last = this.lastSnapshot.get(id) || 0;
    if (Date.now() - last > AUTO_SNAPSHOT_MS) {
      this.lastSnapshot.set(id, Date.now());
      this.snapshot(id, 'auto', body);
    }
  }

  async history(id) {
    const list = await db.byIndex('history', 'doc', id);
    return list.sort((a, b) => b.ts - a.ts);
  }

  async restore(id, snap) {
    await this.snapshot(id, 'before-restore');
    const found = this.find(id);
    if (!found) return;
    const keep = { id: found.meta.id, slug: found.meta.slug, slugLocked: found.meta.slugLocked, createdAt: found.meta.createdAt };
    this.replaceMeta(found, { ...snap.meta, ...keep, updatedAt: Date.now() });
    this.setBody(id, snap.body);
  }

  async discardLocal(id) {
    const p = this.pubOf(id);
    const found = this.find(id);
    if (!p || !found) return;
    await this.snapshot(id, 'before-discard');
    const meta = { ...fromPub(p.kind, p.meta), createdAt: found.meta.createdAt };
    this.replaceMeta(found, meta);
    this.drafts.delete(id);
    this.pendingBodies.set(id, null);
    await this.flushBodies();
    this.changed([id]);
  }

  /* ---------------- published layer ---------------- */

  async setPub(pub, commit) {
    this.pub = pub;
    this.pubCommit = commit;
    await db.put('kv', 'pub', pub);
    await db.put('kv', 'pubCommit', commit);
    this.statusCache.clear();
  }

  /**
   * Brings a newer published index into the workspace. Docs untouched locally
   * fast-forward; docs edited locally keep the local version and get flagged.
   */
  async reconcile(newPub, commit, importedBodies = null) {
    const oldPub = this.pub;
    const conflicts = [];
    const added = [];
    const cleanBefore = new Map();
    for (const d of this.allDocs()) {
      const old = oldPub ? findPub(oldPub, d.id) : null;
      if (!old) continue;
      const found = this.find(d.id);
      const meta = this.fullMeta(found);
      const body = this.drafts.get(d.id);
      cleanBefore.set(d.id, body ? contentHash(d.kind, meta, body) === old.meta.hash : sameFields(d.kind, meta, old.meta));
    }

    if (importedBodies) {
      for (const [id, body] of importedBodies) {
        this.pubBodies.set(id, body);
        await db.put('bodies', `pub:${id}`, body);
      }
    }

    // Categories first so items have somewhere to go.
    for (const c of newPub.gallery) {
      const local = this.ws.gallery.find(x => x.id === c.id);
      const oldCat = oldPub ? oldPub.gallery.find(x => x.id === c.id) : null;
      if (!local) {
        if (!oldCat) this.ws.gallery.push({ id: c.id, slug: c.slug, name: c.name, items: [] });
      } else if (oldCat && local.name === oldCat.name && local.slug === oldCat.slug) {
        local.name = c.name;
        local.slug = c.slug;
      }
    }

    const trashIds = new Set(this.ws.trash.map(t => t.id));
    for (const d of flattenPub(newPub)) {
      const old = oldPub ? findPub(oldPub, d.meta.id) : null;
      const found = this.find(d.meta.id);
      if (!found) {
        if (trashIds.has(d.meta.id)) continue;
        const meta = fromPub(d.kind, d.meta);
        if (d.kind === 'post') this.ws.posts.push(meta);
        else if (d.kind === 'work') this.ws.works.push(meta);
        else if (d.kind === 'galleryItem') {
          let cat = this.ws.gallery.find(c => c.id === d.meta.catId);
          if (!cat) {
            cat = { id: d.cat.id, slug: d.cat.slug, name: d.cat.name, items: [] };
            this.ws.gallery.push(cat);
          }
          cat.items.push(meta);
        } else this.ws.about = meta;
        added.push(d.meta.id);
        continue;
      }
      if (old && old.meta.hash === d.meta.hash) continue;
      const clean = cleanBefore.get(d.meta.id);
      if (clean || (!old && !this.drafts.has(d.meta.id))) {
        const meta = { ...fromPub(d.kind, d.meta), createdAt: found.meta.createdAt || Date.now() };
        if (d.kind === 'galleryItem' && found.cat.id !== d.meta.catId) {
          found.cat.items.splice(found.cat.items.indexOf(found.meta), 1);
          let cat = this.ws.gallery.find(c => c.id === d.meta.catId);
          if (!cat) {
            cat = { id: d.cat.id, slug: d.cat.slug, name: d.cat.name, items: [] };
            this.ws.gallery.push(cat);
          }
          cat.items.push(meta);
        } else {
          this.replaceMeta(found, meta);
        }
        this.drafts.delete(d.meta.id);
        this.pendingBodies.set(d.meta.id, null);
        this.pubBodies.delete(d.meta.id);
        await db.del('bodies', `pub:${d.meta.id}`);
      } else {
        conflicts.push(d.meta.id);
      }
    }

    // Keep the published order where the local order never diverged from it.
    const adoptOrder = (localList, oldList, newList) => {
      if (!oldList) return orderLike(localList, newList);
      const localIds = localList.map(m => m.id).filter(id => oldList.some(o => o.id === id));
      const oldIds = oldList.map(o => o.id).filter(id => localIds.includes(id));
      return localIds.join() === oldIds.join() ? orderLike(localList, newList) : localList;
    };
    this.ws.posts = adoptOrder(this.ws.posts, oldPub && oldPub.posts, newPub.posts);
    this.ws.works = adoptOrder(this.ws.works, oldPub && oldPub.works, newPub.works);
    for (const c of this.ws.gallery) {
      const nc = newPub.gallery.find(x => x.id === c.id);
      const oc = oldPub ? oldPub.gallery.find(x => x.id === c.id) : null;
      if (nc) c.items = adoptOrder(c.items, oc && oc.items, nc.items);
    }
    if (!oldPub) this.ws.gallery = orderLike(this.ws.gallery, newPub.gallery);

    await this.flushBodies();
    await this.setPub(newPub, commit);
    this.changed();
    return { conflicts, added };
  }

  /** Records a successful publish commit. */
  async applyPublished(next, commit, publishedIds, bodies) {
    for (const id of publishedIds) {
      const body = bodies.get(id);
      if (!body) continue;
      this.pubBodies.set(id, body);
      await db.put('bodies', `pub:${id}`, body);
      const found = this.find(id);
      if (found && !found.meta.slugLocked) this.replaceMeta(found, { ...found.meta, slugLocked: true });
    }
    await this.setPub(next, commit);
    this.changed();
  }

  /* ---------------- backup ---------------- */

  async exportAll() {
    await this.flush();
    const bodies = {};
    for (const d of this.allDocs()) bodies[d.id] = await this.getBody(d.id).catch(() => null);
    for (const t of this.ws.trash) bodies[t.id] = this.drafts.get(t.id) || null;
    return { kind: 'devlog-admin-backup', version: 2, exportedAt: new Date().toISOString(), ws: this.ws, bodies };
  }

  async importAll(backup) {
    if (!backup || backup.kind !== 'devlog-admin-backup' || !backup.ws) throw new Error('这不是后台导出的备份文件');
    for (const d of this.allDocs()) await this.snapshot(d.id, 'before-import').catch(() => {});
    this.ws = { ...emptyWorkspace(), ...backup.ws };
    this.drafts.clear();
    const entries = [];
    for (const [id, body] of Object.entries(backup.bodies || {})) {
      if (!body) continue;
      this.drafts.set(id, body);
      entries.push([`draft:${id}`, body]);
    }
    const existing = (await db.keys('bodies')).filter(k => String(k).startsWith('draft:'));
    await db.putMany('bodies', existing.map(k => [k, undefined]));
    await db.putMany('bodies', entries);
    await db.put('kv', 'ws', this.ws);
    this.changed();
  }

  emptyPub() { return emptyPub(); }
}

function orderLike(localList, refList) {
  const idx = new Map(refList.map((m, i) => [m.id, i]));
  const known = localList.filter(m => idx.has(m.id)).sort((a, b) => idx.get(a.id) - idx.get(b.id));
  const unknown = localList.filter(m => !idx.has(m.id));
  return [...unknown, ...known];
}

export { CONTENT_INDEX, docFilePath };
