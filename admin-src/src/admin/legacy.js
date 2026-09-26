import { parseHTMLToDoc, docText } from '../shared/render.js';
import { safeFocus } from '../shared/util.js';

function readJSON(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Drafts the previous admin kept in this browser's localStorage. */
export function readLegacy() {
  const posts = readJSON('posts').filter(p => p && (p.title || p.content));
  const works = readJSON('works').filter(w => w && (w.title || w.content));
  const cats = readJSON('galleryCategories').filter(c => c && Array.isArray(c.items));
  const aboutRaw = localStorage.getItem('aboutHTML');
  const about = aboutRaw && !/在这里介绍你自己/.test(aboutRaw) ? aboutRaw : null;
  const items = cats.reduce((n, c) => n + c.items.length, 0);
  return { posts, works, cats, about, items, total: posts.length + works.length + items + (about ? 1 : 0) };
}

const squash = s => String(s || '').replace(/\s+/g, '');
const sameTitle = (a, b) => squash(a) === squash(b);

function tagsOf(v) {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  return String(v || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean);
}

/**
 * Imports legacy drafts whose text differs from what the new admin has.
 * Existing docs get a history snapshot first; unknown ones become new drafts.
 */
export async function importLegacy(shell) {
  const data = shell.data;
  const legacy = readLegacy();
  const res = { updated: [], created: [], same: 0 };

  const apply = async (kind, found, html, metaPatch, title, catId) => {
    const json = parseHTMLToDoc(html || '', document);
    if (found) {
      const body = await data.getBody(found.meta.id).catch(() => null);
      if (body && squash(docText(body)) === squash(docText(json))) { res.same++; return; }
      await data.snapshot(found.meta.id, 'before-legacy');
      data.setBody(found.meta.id, json);
      res.updated.push(title || '无标题');
      return;
    }
    const id = data.createDoc(kind, { title, catId });
    data.updateMeta(id, metaPatch);
    data.setBody(id, json);
    res.created.push(title || '无标题');
  };

  for (const p of legacy.posts) {
    const found = data.ws.posts.find(m => sameTitle(m.title, p.title));
    await apply('post', found && { meta: found }, p.content, {
      cat: p.cat || '', tags: tagsOf(p.tags), date: p.date || '', cover: p.cover || '', coverPos: safeFocus(p.coverPos),
    }, p.title || '');
  }
  for (const w of legacy.works) {
    const found = data.ws.works.find(m => sameTitle(m.title, w.title));
    await apply('work', found && { meta: found }, w.content, {
      tags: tagsOf(w.tags), date: w.date || '', desc: w.desc || '', cover: w.img || w.cover || '', coverFull: w.imgFull || w.img || '',
      coverPos: safeFocus(w.imgPos || w.coverPos), play: w.play || '', link: w.link || '',
    }, w.title || '');
  }
  for (const c of legacy.cats) {
    let cat = data.ws.gallery.find(x => sameTitle(x.name, c.name) || (c.slug && x.slug === c.slug));
    if (!cat && c.items.length) cat = data.ws.gallery.find(x => x.id === data.createCategory(c.name || '旧后台分类', c.slug || ''));
    if (!cat) continue;
    for (const it of c.items) {
      if (!it.title && !it.content) continue;
      const found = cat.items.find(m => sameTitle(m.title, it.title));
      await apply('galleryItem', found && { meta: found }, it.content, {
        desc: it.desc || '', img: it.img || '', imgFull: it.imgFull || it.img || '', imgPos: safeFocus(it.imgPos),
      }, it.title || '', cat.id);
    }
  }
  if (legacy.about) {
    if (!data.ws.about) data.createDoc('about');
    await apply('about', { meta: data.ws.about }, legacy.about.replace(/^\s*<h1[^>]*>\s*关于我\s*<\/h1>/i, ''), {}, '关于我');
  }
  return res;
}
