import { parseHTMLToDoc, renderDocHTML, toNode } from './render.js';
import { stableId, normLayout, safeFocus } from './util.js';
import { contentHash, pageFields, emptyPub } from './site.js';
import { PATHS } from './templates.js';

const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

export function hrefPath(href) {
  let p = String(href || '');
  try { p = decodeURIComponent(p); } catch { /* keep raw */ }
  p = p.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/^\//, '');
  if (!p || p.endsWith('/')) p += 'index.html';
  return p;
}

function slugFromPath(p) {
  return p.split('/').pop().replace(/\.html$/, '');
}

function cssRule(html, selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}');
  const m = re.exec(html);
  return m ? m[1] : '';
}

export function extractLayout(html, cls, kind) {
  const body = cssRule(html, `.${cls}`);
  const p = cssRule(html, `.${cls} p`);
  let codeFs;
  for (const m of html.matchAll(/pre(?: code)?\{([^}]*)\}/g)) {
    const f = /font-size:([\d.]+)px/.exec(m[1]);
    if (f) { codeFs = f[1]; break; }
  }
  const width = /width:min\(100%,\s*([\d.]+)px\)/.exec(body)?.[1] || /max-width:([\d.]+)px/.exec(body)?.[1];
  // A unitless font-size is invalid CSS, so the page actually inherits the 16px default.
  const fsm = /font-size:([\d.]+)(px)?\s*(?:;|$)/.exec(body);
  const fs = fsm ? (fsm[2] ? fsm[1] : 16) : 16;
  return normLayout({
    width,
    fs,
    lh: /line-height:([\d.]+)/.exec(p)?.[1],
    pgap: /margin:0 0 ([\d.]+)px/.exec(p)?.[1],
    codeFs,
  }, kind);
}

const JUNK = 'script,style,xml,template,noscript,title,meta,link,pre .code-lang,[style*="mso-list:Ignore"],[style*="mso-list: Ignore"]';

export function visibleText(el) {
  const clone = el.cloneNode(true);
  for (const j of [...clone.querySelectorAll(JUNK)]) j.remove();
  return clone.textContent;
}

function objectPosition(el) {
  return safeFocus(el && /object-position:\s*([^;"]+)/.exec(el.getAttribute('style') || '')?.[1]);
}

/**
 * Reads the pages that are live on the site and rebuilds the published index from them.
 * @param {{ readText:(path:string)=>Promise<string|null>, parse:(html:string)=>Document, doc:Document, now?:string }} io
 */
export async function importPublishedSite({ readText, parse, doc, now = new Date().toISOString(), onProgress = () => {} }) {
  const pub = emptyPub();
  const bodies = new Map();
  const sources = new Map();
  const report = [];
  const load = async rel => {
    const html = await readText(rel);
    if (html == null) report.push(`找不到页面 ${rel}`);
    return html;
  };
  const addBody = (id, el) => {
    const json = parseHTMLToDoc(el ? el.innerHTML : '', doc);
    bodies.set(id, json);
    sources.set(id, el ? visibleText(el) : '');
    return json;
  };

  const blogHTML = await load(PATHS.blogIndex);
  if (blogHTML) {
    const cards = [...parse(blogHTML).querySelectorAll('a.blog-card')];
    for (const [i, card] of cards.entries()) {
      const rel = hrefPath(card.getAttribute('href'));
      onProgress(`文章 ${i + 1}/${cards.length}`);
      const html = await load(rel);
      if (!html) continue;
      const d = parse(html);
      const slug = slugFromPath(rel);
      const id = stableId('p', slug);
      const spans = [...d.querySelectorAll('.post-meta > span')].map(text);
      const cover = d.querySelector('img.post-cover');
      const meta = {
        id,
        slug,
        title: text(d.querySelector('.post-title')),
        cat: text(d.querySelector('.post-header .post-cat')).replace(/^#\s*/, ''),
        date: spans[0] || '',
        tags: spans.slice(1),
        cover: cover ? cover.getAttribute('src') : '',
        coverPos: objectPosition(cover),
        layout: extractLayout(html, 'post-body', 'post'),
      };
      const body = addBody(id, d.querySelector('.post-body'));
      pub.posts.push({ ...pageFields('post', meta), hash: contentHash('post', meta, body), publishedAt: now, path: rel });
    }
  }

  const worksHTML = await load(PATHS.worksIndex);
  if (worksHTML) {
    const cards = [...parse(worksHTML).querySelectorAll('a.work-card')];
    for (const [i, card] of cards.entries()) {
      const rel = hrefPath(card.getAttribute('href'));
      onProgress(`项目 ${i + 1}/${cards.length}`);
      const html = await load(rel);
      if (!html) continue;
      const d = parse(html);
      const slug = slugFromPath(rel);
      const id = stableId('w', slug);
      const coverEl = d.querySelector('img.wd-cover');
      const cardImg = card.querySelector('img.wc-img');
      const shell = d.querySelector('.play-shell');
      const linkEl = [...d.querySelectorAll('.page-wrap a[target="_blank"]')].find(a => /查看项目/.test(a.textContent));
      const meta = {
        id,
        slug,
        title: text(d.querySelector('.wd-title')),
        tags: [...d.querySelectorAll('.wd-tags .wd-tag-item')].map(text),
        date: '',
        desc: text(card.querySelector('.wc-desc')),
        cover: coverEl ? coverEl.getAttribute('src') : (cardImg ? cardImg.getAttribute('src') : ''),
        coverFull: coverEl ? (coverEl.getAttribute('data-full-src') || coverEl.getAttribute('src')) : '',
        coverPos: objectPosition(coverEl || cardImg),
        play: shell ? shell.getAttribute('data-src') : '',
        link: linkEl ? linkEl.getAttribute('href') : '',
        layout: extractLayout(html, 'wd-body', 'work'),
      };
      const body = addBody(id, d.querySelector('.wd-body'));
      pub.works.push({ ...pageFields('work', meta), hash: contentHash('work', meta, body), publishedAt: now, path: rel });
    }
  }

  const galleryHTML = await load(PATHS.galleryIndex);
  if (galleryHTML) {
    const catCards = [...parse(galleryHTML).querySelectorAll('a.gallery-card')];
    for (const card of catCards) {
      const catRel = hrefPath(card.getAttribute('href'));
      const catSlug = catRel.split('/')[1];
      const cat = { id: stableId('c', catSlug), slug: catSlug, name: text(card.querySelector('.gc-title')), items: [] };
      const catHTML = await load(catRel);
      if (!catHTML) continue;
      const itemCards = [...parse(catHTML).querySelectorAll('a.gallery-card')];
      for (const [i, ic] of itemCards.entries()) {
        const rel = hrefPath(ic.getAttribute('href'));
        onProgress(`${cat.name} ${i + 1}/${itemCards.length}`);
        const html = await load(rel);
        if (!html) continue;
        const d = parse(html);
        const slug = slugFromPath(rel);
        const id = stableId('g', `${catSlug}/${slug}`);
        const img = ic.querySelector('img.gc-img');
        const m = /var THUMB=("(?:[^"\\]|\\.)*"),FULL=("(?:[^"\\]|\\.)*")/.exec(html);
        const thumb = m ? JSON.parse(m[1]) : (img ? img.getAttribute('src') : '');
        const full = m ? JSON.parse(m[2]) : (ic.getAttribute('data-full') || thumb);
        const meta = {
          id,
          slug,
          catId: cat.id,
          title: text(d.querySelector('.gd-title')),
          desc: text(ic.querySelector('.gc-desc')),
          img: thumb,
          imgFull: full,
          imgPos: objectPosition(img),
          layout: extractLayout(html, 'gd-body', 'galleryItem'),
        };
        const body = addBody(id, d.querySelector('.gd-body'));
        cat.items.push({ ...pageFields('galleryItem', meta), hash: contentHash('galleryItem', meta, body), publishedAt: now, path: rel });
      }
      pub.gallery.push(cat);
    }
  }

  const aboutHTML = await load(PATHS.about());
  if (aboutHTML) {
    const d = parse(aboutHTML);
    const meta = { id: 'about', title: '关于我', layout: extractLayout(aboutHTML, 'about-body', 'about') };
    const body = addBody('about', d.querySelector('.about-body'));
    pub.about = { ...pageFields('about', meta), hash: contentHash('about', meta, body), publishedAt: now, path: PATHS.about() };
  }

  pub.rev = 0;
  pub.updatedAt = now;
  return { pub, bodies, sources, report };
}

function docTextWithCaptions(json) {
  let out = '';
  toNode(json).descendants(n => {
    if (n.isText) out += n.text;
    else if (n.type.name === 'figure' && n.attrs.caption) out += n.attrs.caption;
    return true;
  });
  return out;
}

const squash = s => s.replace(/[\s\u00a0\u200b\ufeff]+/g, '');

/** Checks that no visible text was lost and that render → parse is a fixed point. */
export function validateImport({ bodies, sources, doc }) {
  const problems = [];
  for (const [id, json] of bodies) {
    const again = parseHTMLToDoc(renderDocHTML(json, doc), doc);
    const stable = JSON.stringify(again) === JSON.stringify(json);
    const before = squash(sources.get(id) || '');
    const after = squash(docTextWithCaptions(json));
    if (stable && before === after) continue;
    const p = { id, stable, textOk: before === after, beforeLen: before.length, afterLen: after.length };
    if (!p.textOk) {
      let i = 0;
      while (i < before.length && before[i] === after[i]) i++;
      p.textAt = { before: before.slice(Math.max(0, i - 20), i + 40), after: after.slice(Math.max(0, i - 20), i + 40) };
    }
    if (!stable) {
      const A = json.content || [], B = again.content || [];
      let i = 0;
      while (i < A.length && i < B.length && JSON.stringify(A[i]) === JSON.stringify(B[i])) i++;
      const brief = n => {
        if (!n) return '∅';
        const t = toNode({ type: 'doc', content: [n] }).textContent.slice(0, 30);
        const extra = n.type === 'figure' ? ` [${(n.attrs.caption || '').slice(0, 20)}]` : '';
        return `${n.type}${extra} "${t}"`;
      };
      p.jsonAt = {
        index: i,
        first: A.slice(Math.max(0, i - 2), i + 3).map(brief).join(' | '),
        second: B.slice(Math.max(0, i - 2), i + 3).map(brief).join(' | '),
      };
    }
    problems.push(p);
  }
  return problems;
}
