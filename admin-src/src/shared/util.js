export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugify(str) {
  const s = String(str || '').toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  return s;
}

export function cleanSlug(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[\\/?#%*:|"<>\s]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
}

export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function uid(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function stableId(prefix, key) {
  return `${prefix}_${cyrb53(String(key))}`;
}

export function todayISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function num(v, fallback) {
  const n = parseFloat(String(v == null ? '' : v).replace(/px$/i, ''));
  return Number.isFinite(n) ? n : fallback;
}

export const LAYOUT_DEFAULTS = {
  post: { width: 720, fs: 15, lh: 1.9, pgap: 16, codeFs: 13, indent: false },
  work: { width: 720, fs: 15, lh: 1.9, pgap: 16, codeFs: 13, indent: false },
  galleryItem: { width: 720, fs: 16, lh: 1.9, pgap: 16, codeFs: 13, indent: false },
  about: { width: 720, fs: 16, lh: 1.9, pgap: 16, codeFs: 13, indent: false },
};

export const LAYOUT_LIMITS = {
  width: [480, 1400],
  fs: [12, 22],
  lh: [1.3, 2.6],
  pgap: [0, 48],
  codeFs: [10, 18],
};

export function normLayout(raw, kind = 'post') {
  const d = LAYOUT_DEFAULTS[kind] || LAYOUT_DEFAULTS.post;
  const r = raw || {};
  const L = LAYOUT_LIMITS;
  return {
    width: Math.round(clamp(num(r.width, d.width), ...L.width)),
    fs: Math.round(clamp(num(r.fs ?? r.fontsize ?? r.fontSize, d.fs), ...L.fs)),
    lh: Math.round(clamp(num(r.lh ?? r.lineHeight, d.lh), ...L.lh) * 20) / 20,
    pgap: Math.round(clamp(num(r.pgap ?? r.paraGap, d.pgap), ...L.pgap)),
    codeFs: Math.round(clamp(num(r.codeFs ?? r.codeSize, d.codeFs), ...L.codeFs)),
    indent: !!r.indent,
  };
}

export function layoutStyle(layout) {
  return `--doc-width:${layout.width}px;--doc-fs:${layout.fs}px;--doc-lh:${layout.lh};--doc-pgap:${layout.pgap}px;--doc-code-fs:${layout.codeFs}px;--doc-indent:${layout.indent ? '2em' : '0'}`;
}

export function safeFocus(pos) {
  const m = /^\s*(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%\s*$/.exec(String(pos || ''));
  if (!m) return '50% 50%';
  const x = clamp(parseFloat(m[1]), 0, 100), y = clamp(parseFloat(m[2]), 0, 100);
  return `${+x.toFixed(1)}% ${+y.toFixed(1)}%`;
}

export function safeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^(https?:)?\/\//i.test(s) || s.startsWith('/')) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s;
  return '';
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  d.flush = (...args) => {
    if (t) { clearTimeout(t); t = null; fn(...args); }
  };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}
