import { cyrb53, normLayout, safeFocus, safeUrl } from './util.js';
import { renderDocHTML, excerpt } from './render.js';
import {
  PATHS, renderPostPage, renderWorkPage, renderGalleryItemPage, renderAboutPage,
  renderBlogIndex, renderWorksIndex, renderGalleryIndex, renderCategoryPage, renderRedirect,
} from './templates.js';
import { patchHomepage } from './homepage.js';

export const CONTENT_INDEX = 'content/index.json';
export const docFilePath = id => `content/docs/${id}.json`;

export const KINDS = ['post', 'work', 'galleryItem', 'about'];

const FIELDS = {
  post: ['slug', 'title', 'cat', 'tags', 'date', 'cover', 'coverPos', 'layout'],
  work: ['slug', 'title', 'tags', 'date', 'desc', 'cover', 'coverFull', 'coverPos', 'play', 'link', 'layout'],
  galleryItem: ['slug', 'title', 'desc', 'img', 'imgFull', 'imgPos', 'layout', 'catId'],
  about: ['title', 'layout'],
};

export function pageFields(kind, meta) {
  const out = { id: meta.id };
  for (const f of FIELDS[kind]) {
    let v = meta[f];
    if (f === 'layout') v = normLayout(v, kind);
    else if (f === 'tags') v = Array.isArray(v) ? v.filter(Boolean).map(String) : [];
    else if (f === 'coverPos' || f === 'imgPos') v = safeFocus(v);
    else if (f === 'play' || f === 'link') v = safeUrl(v);
    else v = v == null ? '' : String(v);
    out[f] = v;
  }
  return out;
}

export function contentHash(kind, meta, body) {
  return cyrb53(JSON.stringify([pageFields(kind, meta), body || null]));
}

export function emptyPub() {
  return { format: 1, rev: 0, updatedAt: null, posts: [], works: [], gallery: [], about: null };
}

export function findPub(pub, id) {
  for (const p of pub.posts) if (p.id === id) return { kind: 'post', meta: p };
  for (const w of pub.works) if (w.id === id) return { kind: 'work', meta: w };
  for (const c of pub.gallery) for (const i of c.items) if (i.id === id) return { kind: 'galleryItem', meta: i, cat: c };
  if (pub.about && pub.about.id === id) return { kind: 'about', meta: pub.about };
  return null;
}

export function pathFor(kind, meta, cat) {
  if (kind === 'post') return PATHS.post(meta);
  if (kind === 'work') return PATHS.work(meta);
  if (kind === 'galleryItem') return PATHS.galleryItem(meta, cat);
  return PATHS.about();
}

export function renderPage(kind, meta, body, { css, doc, cat, mode = 'publish', editHead = '' }) {
  const bodyHTML = mode === 'edit' ? '' : renderDocHTML(body, doc);
  const description = body ? excerpt(body, 120) : '';
  const opts = { css, mode, editHead, description };
  if (kind === 'post') return renderPostPage(meta, bodyHTML, opts);
  if (kind === 'work') return renderWorkPage(meta, bodyHTML, opts);
  if (kind === 'galleryItem') return renderGalleryItemPage(cat, meta, bodyHTML, opts);
  return renderAboutPage(meta, bodyHTML, opts);
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function orderBy(list, order) {
  const idx = new Map(order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (idx.has(a.id) ? idx.get(a.id) : 1e9) - (idx.has(b.id) ? idx.get(b.id) : 1e9));
}

/**
 * Computes the next published state and every file a publish commit must write.
 *
 * @param {object} args
 * @param {object} args.basePub      published index as it exists at the base commit
 * @param {object} args.draft        local workspace (drafts, order, categories)
 * @param {string[]} args.publish    doc ids whose draft goes live
 * @param {string[]} args.unpublish  doc ids to take down
 * @param {(id:string)=>object} args.draftBody     draft body lookup
 * @param {(id:string)=>Promise<object>} args.pubBody  published body lookup (for re-renders)
 * @param {boolean} args.rebuildAll  re-render every published page
 * @param {string|null} args.homepageHTML  current index.html, or null to skip it
 */
export async function buildPublish({ basePub, draft, publish = [], unpublish = [], draftBody, pubBody, rebuildAll = false, homepageHTML = null, css, doc, now = new Date().toISOString() }) {
  const next = clone(basePub || emptyPub());
  const files = new Map();
  const warnings = [];
  const rendered = new Set();
  const newBodies = new Map();

  const draftById = new Map();
  for (const p of draft.posts) draftById.set(p.id, { kind: 'post', meta: p });
  for (const w of draft.works) draftById.set(w.id, { kind: 'work', meta: w });
  for (const c of draft.gallery) for (const i of c.items) draftById.set(i.id, { kind: 'galleryItem', meta: { ...i, catId: c.id }, cat: c });
  if (draft.about) draftById.set(draft.about.id, { kind: 'about', meta: draft.about });

  const oldPaths = new Map();
  const collect = pub => {
    for (const p of pub.posts) oldPaths.set(p.id, p.path);
    for (const w of pub.works) oldPaths.set(w.id, w.path);
    for (const c of pub.gallery) for (const i of c.items) oldPaths.set(i.id, i.path);
    if (pub.about) oldPaths.set(pub.about.id, pub.about.path);
  };
  collect(next);
  const oldCategoryPaths = new Map(next.gallery.map(c => [c.id, `gallery/${c.slug}/index.html`]));
  const oldCategoryMeta = new Map(next.gallery.map(c => [c.id, { name: c.name, slug: c.slug }]));

  for (const id of unpublish) {
    next.posts = next.posts.filter(p => p.id !== id);
    next.works = next.works.filter(w => w.id !== id);
    for (const c of next.gallery) c.items = c.items.filter(i => i.id !== id);
    if (next.about && next.about.id === id) next.about = null;
  }

  // Gallery categories follow the draft (names, slugs, order); items keep their published state.
  const pubItems = new Map();
  for (const c of next.gallery) for (const i of c.items) pubItems.set(i.id, { ...i, catId: i.catId || c.id });
  const draftCats = draft.gallery.map(c => ({ id: c.id, slug: c.slug, name: c.name }));
  const knownCatIds = new Set(draftCats.map(c => c.id));
  for (const c of next.gallery) if (!knownCatIds.has(c.id)) draftCats.push({ id: c.id, slug: c.slug, name: c.name });

  for (const id of publish) {
    const d = draftById.get(id);
    if (!d) { warnings.push(`找不到要发布的文档 ${id}`); continue; }
    const body = draftBody(id);
    newBodies.set(id, body);
    const fields = pageFields(d.kind, d.meta);
    const cat = d.kind === 'galleryItem' ? draftCats.find(c => c.id === d.meta.catId) : null;
    const meta = { ...fields, hash: contentHash(d.kind, d.meta, body), publishedAt: now, path: pathFor(d.kind, fields, cat) };
    if (d.kind === 'post') {
      const i = next.posts.findIndex(p => p.id === id);
      if (i >= 0) next.posts[i] = meta; else next.posts.push(meta);
    } else if (d.kind === 'work') {
      const i = next.works.findIndex(w => w.id === id);
      if (i >= 0) next.works[i] = meta; else next.works.push(meta);
    } else if (d.kind === 'galleryItem') {
      pubItems.set(id, meta);
    } else {
      next.about = meta;
    }
  }

  next.posts = orderBy(next.posts, draft.posts.map(p => p.id));
  next.works = orderBy(next.works, draft.works.map(w => w.id));

  const draftItemOrder = draft.gallery.flatMap(c => c.items.map(i => i.id));
  next.gallery = draftCats.map(c => {
    const items = orderBy([...pubItems.values()].filter(i => i.catId === c.id), draftItemOrder);
    return { id: c.id, slug: c.slug, name: c.name, items };
  }).filter(c => c.items.length);

  // Category renames/moves change every item page in that category.
  const rerender = new Set();
  for (const c of next.gallery) {
    const before = oldCategoryMeta.get(c.id);
    for (const i of c.items) {
      const newPath = PATHS.galleryItem(i, c);
      if (i.path !== newPath || !before || before.name !== c.name || before.slug !== c.slug) {
        if (!newBodies.has(i.id)) rerender.add(i.id);
        i.path = newPath;
      }
    }
  }
  if (rebuildAll) {
    for (const p of next.posts) rerender.add(p.id);
    for (const w of next.works) rerender.add(w.id);
    for (const c of next.gallery) for (const i of c.items) rerender.add(i.id);
    if (next.about) rerender.add(next.about.id);
  }
  for (const id of newBodies.keys()) rerender.delete(id);

  const ctx = { css, doc };
  const renderOne = async (id, body) => {
    const found = findPub(next, id);
    if (!found) return;
    const html = renderPage(found.kind, found.meta, body, { ...ctx, cat: found.cat });
    files.set(found.meta.path, html);
    rendered.add(found.meta.path);
  };
  for (const [id, body] of newBodies) {
    if (findPub(next, id)) await renderOne(id, body);
  }
  for (const id of rerender) {
    const body = await pubBody(id);
    if (!body) { warnings.push(`缺少已发布正文 ${id}，跳过重新生成`); continue; }
    await renderOne(id, body);
  }

  // Moved pages leave a redirect behind; removed pages are deleted.
  const livePaths = new Set();
  for (const p of next.posts) livePaths.add(p.path);
  for (const w of next.works) livePaths.add(w.path);
  for (const c of next.gallery) for (const i of c.items) livePaths.add(i.path);
  if (next.about) livePaths.add(next.about.path);

  for (const [id, oldPath] of oldPaths) {
    if (!oldPath || livePaths.has(oldPath)) continue;
    const now2 = findPub(next, id);
    if (now2) files.set(oldPath, renderRedirect(now2.meta.path));
    else files.set(oldPath, null);
  }

  files.set(PATHS.blogIndex, renderBlogIndex(next.posts, ctx));
  files.set(PATHS.worksIndex, renderWorksIndex(next.works, ctx));
  files.set(PATHS.galleryIndex, renderGalleryIndex(next.gallery, ctx));
  const liveCatPaths = new Set();
  for (const c of next.gallery) {
    const p = PATHS.category(c);
    liveCatPaths.add(p);
    files.set(p, renderCategoryPage(c, ctx));
  }
  for (const [, p] of oldCategoryPaths) {
    if (!liveCatPaths.has(p) && !files.has(p)) files.set(p, renderRedirect('gallery/index.html'));
  }

  if (homepageHTML != null) {
    const res = patchHomepage(homepageHTML, { posts: next.posts, works: next.works });
    warnings.push(...res.warnings);
    if (res.changed) files.set('index.html', res.html);
  }

  next.format = 1;
  next.rev = (basePub && basePub.rev ? basePub.rev : 0) + 1;
  next.updatedAt = now;
  files.set(CONTENT_INDEX, JSON.stringify(next, null, 1) + '\n');
  for (const [id, body] of newBodies) {
    if (findPub(next, id)) files.set(docFilePath(id), JSON.stringify({ id, doc: body }) + '\n');
  }
  for (const id of unpublish) {
    if (!findPub(next, id)) files.set(docFilePath(id), null);
  }

  return { next, files, warnings };
}
