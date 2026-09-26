import { esc, safeFocus } from './util.js';
import { PATHS } from './templates.js';

function findElementRange(html, id) {
  const marker = `id="${id}"`;
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const open = html.lastIndexOf('<', at);
  if (open < 0 || !/^<div\b/i.test(html.slice(open, open + 5))) return null;
  const innerStart = html.indexOf('>', at) + 1;
  if (innerStart <= 0) return null;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = innerStart;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') depth--;
    else if (!m[0].endsWith('/>')) depth++;
    if (depth === 0) return { innerStart, innerEnd: m.index };
  }
  return null;
}

const EMPTY_STYLE = 'font-family:var(--font-mono);font-size:12px;color:var(--muted);letter-spacing:2px;';

// The homepage script fills empty lists from the old admin's localStorage, so an empty list still needs an element.
export function homePostsHTML(posts) {
  if (!posts.length) return `<div class="no-posts-placeholder" style="${EMPTY_STYLE}padding:20px 24px;">// 暂无已发布文章</div>`;
  return posts.slice(0, 6).map(p =>
    `<a class="post-item" href="/${esc(PATHS.post(p))}">`
    + '<span class="post-drag-handle" style="display:none">⠿</span>'
    + `<span class="post-date">${esc(p.date || '')}</span>`
    + `<span class="post-cat">${esc(p.cat || '未分类')}</span>`
    + `<span class="post-title">${esc(p.title || '')}</span>`
    + '<span class="post-arrow">→</span>'
    + '</a>').join('');
}

export function homeWorksHTML(works) {
  const cards = works.slice(0, 6).map(w => {
    const cover = w.cover
      ? `<img class="proj-cover" src="${esc(w.cover)}" alt="${esc(w.title || '')}" style="object-position:${safeFocus(w.coverPos)}">`
      : '';
    const firstTag = (w.tags || [])[0];
    return `<a class="proj-card" href="/${esc(PATHS.work(w))}">`
      + cover
      + '<div class="card-controls"><div class="card-drag-handle">⠿⠿</div>'
      + '<button class="card-delete" onclick="this.closest(\'.proj-card\').remove()">✕</button></div>'
      + `<div class="proj-tag">// ${esc(firstTag ? firstTag.toUpperCase() : 'PROJECT')}</div>`
      + `<div class="proj-name">${esc(w.title || '')}</div>`
      + `<div class="proj-desc">${esc(w.desc || '')}</div>`
      + `<div class="proj-meta">${(w.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`
      + '</a>';
  }).join('') || `<div style="${EMPTY_STYLE}padding:28px;grid-column:1/-1;">// 暂无项目</div>`;
  return cards + '<button class="add-card-btn" onclick="addProject(this)">＋ 添加项目</button>';
}

/**
 * Replaces only the inner HTML of the two admin-managed homepage blocks and leaves
 * every other byte of index.html untouched.
 */
export function patchHomepage(html, { posts, works }) {
  const warnings = [];
  let out = html;
  const worksRange = findElementRange(out, 'dynamic-works-grid');
  if (worksRange) {
    out = out.slice(0, worksRange.innerStart) + '\n    ' + homeWorksHTML(works) + '\n  ' + out.slice(worksRange.innerEnd);
  } else {
    warnings.push('首页里找不到项目区块（dynamic-works-grid），已跳过');
  }
  const postsRange = findElementRange(out, 'dynamic-posts-list');
  if (postsRange) {
    out = out.slice(0, postsRange.innerStart) + homePostsHTML(posts) + out.slice(postsRange.innerEnd);
  } else {
    warnings.push('首页里找不到博客区块（dynamic-posts-list），已跳过');
  }
  return { html: out, changed: out !== html, warnings };
}
