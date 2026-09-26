import { db } from './db.js';

const PRESETS = {
  body: { max: 2400, quality: 0.86 },
  cover: { max: 1920, quality: 0.86 },
  gallery: { max: 1200, quality: 0.82, full: { max: 3200, quality: 0.9 } },
};

const KEEP_ORIGINAL = /^image\/(gif|svg\+xml)$/i;
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

let webpSupported = null;
async function canEncodeWebp() {
  if (webpSupported != null) return webpSupported;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.8));
    webpSupported = !!blob && blob.type === 'image/webp';
  } catch {
    webpSupported = false;
  }
  return webpSupported;
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function encode(source, { max, quality }, hasAlphaHint) {
  const w0 = source.width || source.naturalWidth;
  const h0 = source.height || source.naturalHeight;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  let type = (await canEncodeWebp()) ? 'image/webp' : (hasAlphaHint ? 'image/png' : 'image/jpeg');
  let blob = await new Promise(r => canvas.toBlob(r, type, quality));
  if (!blob) throw new Error('浏览器无法压缩这张图片');
  if (blob.type !== type) type = blob.type;
  return { blob, width: w, height: h, type };
}

function stamp() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Keeps processed-but-unpublished images in IndexedDB and serves blob URLs for them,
 * so the editor can show them immediately while the real jsDelivr URL only starts
 * working after the publish commit uploads the file.
 */
export class ImageStore {
  constructor(repo) {
    this.repo = repo;
    this.urls = new Map();
    this.meta = new Map();
  }

  setRepo(repo) { this.repo = repo; }

  base() {
    const { user, repo } = this.repo();
    return user && repo ? `https://cdn.jsdelivr.net/gh/${user}/${repo}@main/` : null;
  }

  urlFor(path) {
    const base = this.base();
    return base ? base + path : '/' + path;
  }

  pathOf(src) {
    if (!src) return null;
    const base = this.base();
    if (base && src.startsWith(base)) return decodeURI(src.slice(base.length));
    const m = /^https:\/\/cdn\.jsdelivr\.net\/gh\/[^/]+\/[^/@]+@[^/]+\/(.+)$/i.exec(src)
      || /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/i.exec(src)
      || /^https:\/\/[^/]+\.github\.io\/(images\/.+)$/i.exec(src)
      || /^\/(images\/.+)$/.exec(src);
    return m ? decodeURI(m[1]) : null;
  }

  isOwn(src) {
    if (!src) return true;
    if (src.startsWith('blob:') || src.startsWith('data:')) return false;
    return !!this.pathOf(src);
  }

  async init() {
    const all = await db.all('blobs');
    const keys = await db.keys('blobs');
    keys.forEach((k, i) => {
      const rec = all[i];
      if (!rec || !rec.blob) return;
      this.meta.set(k, { path: k, pending: rec.pending, size: rec.blob.size, type: rec.blob.type, createdAt: rec.createdAt, width: rec.width, height: rec.height, name: rec.name });
      this.urls.set(k, URL.createObjectURL(rec.blob));
    });
  }

  displaySrc(src) {
    const path = this.pathOf(src);
    if (path && this.urls.has(path)) return this.urls.get(path);
    return src;
  }

  isPending(src) {
    const path = this.pathOf(src);
    return !!(path && this.meta.get(path)?.pending);
  }

  pendingPaths() {
    return [...this.meta.values()].filter(m => m.pending).map(m => m.path);
  }

  list() {
    return [...this.meta.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async getBlob(path) {
    const rec = await db.get('blobs', path);
    return rec ? rec.blob : null;
  }

  async add(blob, ext, extra = {}) {
    const path = `images/${stamp()}.${ext}`;
    const rec = { blob, pending: true, createdAt: Date.now(), ...extra };
    await db.put('blobs', path, rec);
    this.meta.set(path, { path, pending: true, size: blob.size, type: blob.type, createdAt: rec.createdAt, width: extra.width, height: extra.height, name: extra.name });
    this.urls.set(path, URL.createObjectURL(blob));
    return { path, src: this.urlFor(path) };
  }

  async markUploaded(paths) {
    for (const path of paths) {
      const rec = await db.get('blobs', path);
      if (!rec) continue;
      rec.pending = false;
      rec.uploadedAt = Date.now();
      await db.put('blobs', path, rec);
      const m = this.meta.get(path);
      if (m) m.pending = false;
    }
  }

  async remove(path) {
    await db.del('blobs', path);
    const url = this.urls.get(path);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(path);
    this.meta.delete(path);
  }

  /** Drops uploaded local copies older than `days` once the CDN has certainly caught up. */
  async prune(days = 14) {
    const cutoff = Date.now() - days * 86400000;
    for (const m of [...this.meta.values()]) {
      if (!m.pending && m.createdAt < cutoff) await this.remove(m.path);
    }
  }

  /**
   * purpose: 'body' | 'cover' | 'gallery'
   * Returns { src, full?, width, height }
   */
  async process(file, purpose = 'body') {
    const preset = PRESETS[purpose] || PRESETS.body;
    const name = file.name || '';
    if (KEEP_ORIGINAL.test(file.type)) {
      const ext = EXT[file.type] || 'gif';
      const { src } = await this.add(file, ext, { name });
      return { src, full: src };
    }
    const bitmap = await decode(file);
    const alpha = /png|webp/i.test(file.type);
    const main = await encode(bitmap, preset, alpha);
    const out = {};
    const saved = await this.add(main.blob, EXT[main.type] || 'webp', { name, width: main.width, height: main.height });
    out.src = saved.src;
    out.width = main.width;
    out.height = main.height;
    if (preset.full) {
      const w0 = bitmap.width || bitmap.naturalWidth;
      const h0 = bitmap.height || bitmap.naturalHeight;
      if (Math.max(w0, h0) > preset.max) {
        const full = await encode(bitmap, preset.full, alpha);
        out.full = (await this.add(full.blob, EXT[full.type] || 'webp', { name, width: full.width, height: full.height })).src;
      } else {
        out.full = out.src;
      }
    }
    if (bitmap.close) bitmap.close();
    return out;
  }

  /** Downloads an external image and stores it as a pending upload. */
  async adopt(src) {
    const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`下载失败（${res.status}）`);
    const blob = await res.blob();
    if (!/^image\//.test(blob.type)) throw new Error('链接不是图片');
    const file = new File([blob], 'remote', { type: blob.type });
    return (await this.process(file, 'body')).src;
  }

  purge(paths) {
    const { user, repo } = this.repo();
    if (!user || !repo) return;
    for (const p of paths) {
      fetch(`https://purge.jsdelivr.net/gh/${user}/${repo}@main/${p}`, { mode: 'no-cors' }).catch(() => {});
    }
  }
}

/** Every image URL referenced by a doc body or its meta. */
export function collectImageSrcs(meta, body) {
  const out = new Set();
  for (const k of ['cover', 'coverFull', 'img', 'imgFull']) if (meta && meta[k]) out.add(meta[k]);
  const walk = n => {
    if (!n) return;
    if (n.type === 'figure' && n.attrs && n.attrs.src) out.add(n.attrs.src);
    if (n.content) n.content.forEach(walk);
  };
  walk(body);
  return out;
}
