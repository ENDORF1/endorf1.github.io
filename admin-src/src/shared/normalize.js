import { resolveLanguage } from './lowlight.js';

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080', silver: '#c0c0c0', cyan: '#00ffff',
  aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', lime: '#00ff00', pink: '#ffc0cb', teal: '#008080',
  navy: '#000080', maroon: '#800000', olive: '#808000', gold: '#ffd700', crimson: '#dc143c', coral: '#ff7f50',
  tomato: '#ff6347', violet: '#ee82ee', orchid: '#da70d6', skyblue: '#87ceeb', deepskyblue: '#00bfff',
  dodgerblue: '#1e90ff', hotpink: '#ff69b4', deeppink: '#ff1493', springgreen: '#00ff7f', turquoise: '#40e0d0',
};

export function parseColor(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  return null;
}

function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  return { h: 0, s, l };
}

function hex({ r, g, b }) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function luminance({ r, g, b }) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * Pasted text colors, adapted to the dark theme: black/white and dark greys fall back
 * to the theme's text color, mid greys stay (muted text), and hues too dark to read
 * are lightened until they reach about 4:1 contrast against the page background.
 */
export function vividColor(input) {
  const c = parseColor(input);
  if (!c || c.a < 0.5) return null;
  const { s, l } = toHsl(c);
  if (s < 0.35) return l >= 0.45 && l <= 0.8 ? hex(c) : null;
  if (l > 0.86) return null;
  let x = c;
  for (let t = 0.1; luminance(x) < 0.16 && t < 0.95; t += 0.1) {
    x = { r: c.r + (255 - c.r) * t, g: c.g + (255 - c.g) * t, b: c.b + (255 - c.b) * t };
  }
  return hex(x);
}

/**
 * Maps an arbitrary cell fill (Word, Excel, web tables) to the nearest palette
 * color, so shaded cells stay shaded without clashing with the dark theme.
 */
export function cellColorId(input) {
  const c = parseColor(input);
  if (!c || c.a < 0.1) return null;
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const chroma = (max - min) / 255;
  const light = (max + min) / 510;
  if (chroma < 0.04) return light > 0.15 && light < 0.9 ? 'gray' : null;
  let h;
  if (max === c.r) h = ((c.g - c.b) / (max - min) + 6) % 6;
  else if (max === c.g) h = (c.b - c.r) / (max - min) + 2;
  else h = (c.r - c.g) / (max - min) + 4;
  h *= 60;
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 190) return 'cyan';
  if (h < 240) return 'blue';
  return 'purple';
}

const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'TEMPLATE', 'NOSCRIPT', 'XML', 'HEAD',
  'OBJECT', 'APPLET', 'BUTTON', 'SELECT', 'TEXTAREA', 'SVG', 'CANVAS', 'MATH', 'MAP', 'AREA', 'COLGROUP', 'COL']);

const INLINE_TAGS = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'FONT', 'I',
  'IMG', 'KBD', 'LABEL', 'MARK', 'Q', 'RP', 'RT', 'RUBY', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB',
  'SUP', 'TIME', 'U', 'VAR', 'WBR', 'DEL', 'INS', 'BIG', 'TT', 'INPUT']);

function walk(node, fn) {
  let child = node.firstChild;
  while (child) {
    const next = child.nextSibling;
    fn(child);
    if (child.parentNode) walk(child, fn);
    child = next;
  }
}

function unwrap(el) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function rename(el, tag) {
  const doc = el.ownerDocument;
  const n = doc.createElement(tag);
  for (const attr of [...el.attributes]) n.setAttribute(attr.name, attr.value);
  while (el.firstChild) n.appendChild(el.firstChild);
  el.parentNode.replaceChild(n, el);
  return n;
}

function styleMap(el) {
  const out = {};
  const raw = el.getAttribute && el.getAttribute('style');
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function isBlockish(el) {
  return el.nodeType === 1 && !INLINE_TAGS.has(el.tagName);
}

function hasBlockChild(el) {
  for (const c of el.childNodes) if (c.nodeType === 1 && isBlockish(c)) return true;
  return false;
}

function textAlignOf(el) {
  const st = styleMap(el);
  const v = (st['text-align'] || el.getAttribute('align') || '').toLowerCase();
  return ['center', 'right', 'justify'].includes(v) ? v : '';
}

const ALIGN_TARGETS = new Set(['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'P', 'H1', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE', 'TD', 'TH']);

/** text-align set on the element itself: null when unset or inherited, '' when reset to the default. */
function ownAlign(el) {
  if (INLINE_TAGS.has(el.tagName)) return null;
  // On a table, align= positions the table itself rather than its text.
  const v = (styleMap(el)['text-align'] || (el.tagName === 'TABLE' ? '' : el.getAttribute('align')) || '').trim().toLowerCase();
  if (!v || v === 'inherit') return null;
  if (v === 'center' || v === '-webkit-center') return 'center';
  if (v === 'right' || v === '-webkit-right') return 'right';
  return v === 'justify' ? 'justify' : '';
}

/**
 * text-align is inherited, and the old editor often left a <div style="text-align:center">
 * open around the rest of a page. Writes the inherited value onto every block before the
 * wrappers are unwrapped, so text that was centred on the page stays centred.
 */
function inheritAlignment(el, inherited) {
  for (const child of el.children) {
    if (child.tagName === 'PRE' || child.tagName === 'FIGURE') continue;
    const own = ownAlign(child);
    if (own === null && inherited && ALIGN_TARGETS.has(child.tagName)) {
      const st = (child.getAttribute('style') || '').trim();
      child.setAttribute('style', (st && !st.endsWith(';') ? st + ';' : st) + 'text-align:' + inherited);
    }
    inheritAlignment(child, own === null ? inherited : own);
  }
}

function convertWordLists(root) {
  const doc = root.ownerDocument;
  const paras = [...root.querySelectorAll('p')].filter(p => /mso-list\s*:/i.test(p.getAttribute('style') || '') && !/mso-list\s*:\s*ignore/i.test(p.getAttribute('style') || ''));
  if (!paras.length) return;
  const handled = new Set();
  for (const first of paras) {
    if (handled.has(first)) continue;
    const run = [];
    let cur = first;
    while (cur && cur.nodeType === 1 && cur.tagName === 'P' && /mso-list\s*:/i.test(cur.getAttribute('style') || '')) {
      run.push(cur);
      handled.add(cur);
      let next = cur.nextSibling;
      while (next && next.nodeType === 3 && !next.textContent.trim()) next = next.nextSibling;
      cur = next;
    }
    const items = run.map(p => {
      const st = p.getAttribute('style') || '';
      const lv = /level(\d+)/i.exec(st);
      let marker = '';
      for (const ig of [...p.querySelectorAll('[style*="mso-list"]')]) {
        if (/mso-list\s*:\s*ignore/i.test(ig.getAttribute('style') || '')) {
          marker += ig.textContent;
          ig.remove();
        }
      }
      marker = marker.replace(/\u00a0/g, ' ').trim();
      const ordered = /^[(（\[]?([0-9]{1,3}|[a-zA-Z]|[ivxlcdmIVXLCDM]{1,5}|[一二三四五六七八九十]{1,3})[.)）\]、．]/.test(marker);
      return { p, level: lv ? parseInt(lv[1], 10) : 1, ordered };
    });
    const top = doc.createElement(items[0].ordered ? 'ol' : 'ul');
    run[0].parentNode.insertBefore(top, run[0]);
    const stack = [{ list: top, level: items[0].level, lastLi: null }];
    for (const it of items) {
      while (stack.length > 1 && it.level < stack[stack.length - 1].level) stack.pop();
      let frame = stack[stack.length - 1];
      if (it.level > frame.level && frame.lastLi) {
        const sub = doc.createElement(it.ordered ? 'ol' : 'ul');
        frame.lastLi.appendChild(sub);
        frame = { list: sub, level: it.level, lastLi: null };
        stack.push(frame);
      }
      const li = doc.createElement('li');
      const np = doc.createElement('p');
      while (it.p.firstChild) np.appendChild(it.p.firstChild);
      li.appendChild(np);
      frame.list.appendChild(li);
      frame.lastLi = li;
      it.p.remove();
    }
  }
}

function fixPre(pre) {
  const doc = pre.ownerDocument;
  let lang = null;
  const label = pre.querySelector('.code-lang');
  if (label) {
    lang = resolveLanguage(label.textContent);
    label.remove();
  }
  const code = pre.querySelector('code');
  const cls = code && [...code.classList].find(c => /^lang(uage)?-/.test(c));
  if (cls) lang = resolveLanguage(cls.replace(/^lang(uage)?-/, '')) || lang;
  if (!lang) lang = resolveLanguage(pre.getAttribute('data-language') || pre.getAttribute('lang'));
  const source = code || pre;
  let text;
  const lines = source.querySelectorAll(':scope > .line, :scope > div, :scope > p');
  if (lines.length) {
    text = [...lines].map(l => l.textContent).join('\n');
  } else {
    const clone = source.cloneNode(true);
    for (const br of [...clone.querySelectorAll('br')]) br.replaceWith(doc.createTextNode('\n'));
    text = clone.textContent;
  }
  text = text.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const npre = doc.createElement('pre');
  const ncode = doc.createElement('code');
  ncode.className = 'language-' + (lang || 'plaintext');
  ncode.textContent = text;
  npre.appendChild(ncode);
  pre.parentNode.replaceChild(npre, pre);
}

function lastMeaningfulChild(el) {
  let c = el.lastChild;
  while (c && c.nodeType === 3 && !c.textContent.replace(/[ \t\r\n]/g, '')) c = c.previousSibling;
  return c;
}

function removeTrailingBr(block) {
  let cur = block;
  for (let depth = 0; depth < 8; depth++) {
    const last = lastMeaningfulChild(cur);
    if (!last || last.nodeType !== 1) return;
    if (last.tagName === 'BR') {
      last.remove();
      return;
    }
    if (!INLINE_TAGS.has(last.tagName)) return;
    cur = last;
  }
}

const EMPTY_OK = new Set(['BR', 'IMG', 'INPUT', 'WBR']);

function removeEmptyInlines(root) {
  for (const el of [...root.querySelectorAll('*')].reverse()) {
    if (!el.parentNode || !INLINE_TAGS.has(el.tagName) || EMPTY_OK.has(el.tagName)) continue;
    if (el.closest('pre')) continue;
    if (!el.textContent.length && !el.querySelector('img,br,input,iframe')) el.remove();
  }
}

/** A block holding only collapsible whitespace has no height on the page, unlike <p><br></p> or <p>&nbsp;</p>. */
function isInvisibleBlock(el) {
  const text = el.textContent;
  if (!text || /[^ \t\n\r\f]/.test(text) || el.querySelector('br,img,iframe,video,table,hr,input')) return false;
  for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
    if (n.tagName === 'PRE' || /white-space\s*:\s*(pre|break-spaces)/i.test(n.getAttribute('style') || '')) return false;
  }
  return true;
}

function nextToInline(el, dir) {
  let n = el[dir];
  while (n && n.nodeType === 3 && !/[^ \t\n\r\f]/.test(n.textContent)) n = n[dir];
  return !!n && (n.nodeType === 3 || (n.nodeType === 1 && INLINE_TAGS.has(n.tagName)));
}

function hasContent(el) {
  return !!(el.textContent.replace(/[\s\u00a0\u200b]/g, '') || (el.querySelector && el.querySelector('img,iframe,video,table')));
}

const CAPTION_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,div,table,ul,ol,figure,pre,blockquote,img,hr,section,article';

function flattenInto(node, out) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 1 && child.tagName === 'FIGCAPTION') flattenInto(child, out);
    else if (child.nodeType === 1 ? hasContent(child) || child.tagName === 'IMG' : child.nodeType === 3 && child.textContent.trim()) out.push(child);
  }
}

/**
 * Rebuilds every <figure> as exactly one image plus an optional one-line caption.
 * Anything else a figure picked up (text typed into the caption, nested figures,
 * extra images) is moved out after it, in reading order.
 */
function normalizeFigures(root) {
  const doc = root.ownerDocument;
  for (const fig of [...root.querySelectorAll('figure')]) {
    if (!fig.parentNode || !root.contains(fig)) continue;
    const img = [...fig.querySelectorAll('img')].find(i => !i.closest('figcaption') || !fig.contains(i.closest('figcaption')));
    if (!img) {
      unwrap(fig);
      continue;
    }
    const imgFig = img.closest('figure');
    let caption = '';
    const spill = [];
    for (const cap of [...fig.querySelectorAll('figcaption')]) {
      const owner = cap.closest('figure');
      if (owner !== fig && owner !== imgFig) continue;
      const firstBlock = cap.querySelector(CAPTION_BLOCKS);
      if (!firstBlock) {
        if (!caption) caption = cap.textContent.replace(/\s+/g, ' ').trim();
        cap.remove();
        continue;
      }
      let top = firstBlock;
      while (top.parentNode !== cap) top = top.parentNode;
      const lead = [];
      for (let n = cap.firstChild; n && n !== top; n = n.nextSibling) lead.push(n);
      const leadText = lead.map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
      if (!caption && leadText) caption = leadText;
      for (const n of lead) n.remove();
    }
    const parent = fig.parentNode;
    const clean = doc.createElement('figure');
    for (const a of [...fig.attributes]) clean.setAttribute(a.name, a.value);
    clean.appendChild(img);
    if (caption) {
      const c = doc.createElement('figcaption');
      c.textContent = caption;
      clean.appendChild(c);
    }
    parent.insertBefore(clean, fig);
    flattenInto(fig, spill);
    for (const n of spill) parent.insertBefore(n, fig);
    fig.remove();
  }
}

function splitBlockAround(block, target) {
  const path = [];
  for (let n = target; n && n !== block; n = n.parentNode) path.unshift(n);
  const before = block.cloneNode(false);
  const after = block.cloneNode(false);
  const build = (orig, depth, b, a) => {
    const pivot = path[depth];
    let seen = false;
    for (const child of [...orig.childNodes]) {
      if (child === pivot) {
        seen = true;
        if (depth === path.length - 1) continue;
        const cb = child.cloneNode(false), ca = child.cloneNode(false);
        build(child, depth + 1, cb, ca);
        if (cb.childNodes.length) b.appendChild(cb);
        if (ca.childNodes.length) a.appendChild(ca);
      } else if (!seen) {
        b.appendChild(child);
      } else {
        a.appendChild(child);
      }
    }
  };
  build(block, 0, before, after);
  const parent = block.parentNode;
  if (hasContent(before)) parent.insertBefore(before, block);
  parent.insertBefore(target, block);
  if (hasContent(after)) parent.insertBefore(after, block);
  block.remove();
}

function isInlineNode(n) {
  return n.nodeType === 3 || (n.nodeType === 1 && INLINE_TAGS.has(n.tagName) && n.tagName !== 'IMG');
}

/** Wraps runs of loose inline content (text, marks, <br>) in <p> so every container holds only blocks. */
function wrapLooseInline(container) {
  const doc = container.ownerDocument;
  const align = textAlignOf(container);
  let run = [];
  const flush = before => {
    if (!run.length) return;
    const meaningful = run.some(n => (n.nodeType === 3 ? n.textContent.replace(/[\s\u00a0\u200b]/g, '') : n.tagName !== 'BR' && hasContent(n)));
    if (meaningful) {
      const p = doc.createElement('p');
      if (align) p.setAttribute('style', 'text-align:' + align);
      container.insertBefore(p, before);
      for (const n of run) p.appendChild(n);
    } else {
      for (const n of run) n.remove();
    }
    run = [];
  };
  for (const child of [...container.childNodes]) {
    if (isInlineNode(child)) run.push(child);
    else flush(child);
  }
  flush(null);
}

const LIFT_SEL = 'img, iframe, p, h1, h2, h3, h4, ul, ol, table, blockquote, pre, figure, hr, div';

/** Textblocks can't hold blocks: split any p/h1–h4 around images and nested blocks. */
function liftBlocks(root) {
  for (const target of [...root.querySelectorAll(LIFT_SEL)]) {
    if (!target.parentNode || !root.contains(target)) continue;
    if (target.tagName === 'IMG' && target.closest('figure')) continue;
    if (target.parentNode.closest('pre')) continue;
    const block = target.parentNode.closest('p, h1, h2, h3, h4');
    if (block && root.contains(block)) splitBlockAround(block, target);
  }
}

function isEmptyPara(el) {
  if (!el || el.nodeType !== 1 || el.tagName !== 'P') return false;
  if (el.querySelector('img,iframe,video')) return false;
  return !el.textContent.replace(/[\s\u00a0\u200b]/g, '');
}

const BLOCK_NEIGHBOURS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'PRE', 'FIGURE', 'IMG', 'IFRAME', 'BLOCKQUOTE', 'HR', 'UL', 'OL', 'DIV']);

function collapseEmptyParas(root) {
  const kids = () => [...root.childNodes].filter(n => n.nodeType === 1 || n.textContent.trim());
  let list = kids();
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (!isEmptyPara(el)) continue;
    const prev = list[i - 1], next = list[i + 1];
    if (!prev || !next || isEmptyPara(prev) || BLOCK_NEIGHBOURS.has(prev.tagName) || BLOCK_NEIGHBOURS.has(next && next.tagName)) {
      el.remove();
      list = kids();
      i = -1;
    }
  }
}

/**
 * Cleans foreign HTML (Word, Feishu, Google Docs, old editor output) so that the
 * document schema parses it into tidy blocks.
 * @param {string} html
 * @param {{ doc: Document, keepAllColors?: boolean, collapseEmpty?: boolean }} opts
 * @returns {HTMLElement} container element holding the cleaned nodes
 */
export function normalizeHTML(html, { doc, keepAllColors = false, collapseEmpty = true } = {}) {
  const root = doc.createElement('div');
  root.innerHTML = html;

  walk(root, n => {
    if (n.nodeType === 8) n.remove();
  });

  for (const el of [...root.querySelectorAll('*')]) {
    if (!el.parentNode) continue;
    const tag = el.tagName;
    if (DROP_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    // Word's VML tags are often left unclosed, so real text ends up nested inside them.
    if (tag.includes(':')) {
      unwrap(el);
      continue;
    }
    if (tag === 'INPUT') {
      if ((el.getAttribute('type') || '').toLowerCase() !== 'checkbox' || !el.closest('li')) el.remove();
    }
  }
  for (const el of [...root.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6')]) {
    // Between two runs of text even an empty block still ends a line, so only drop it next to other blocks.
    if (el.parentNode && isInvisibleBlock(el) && !nextToInline(el, 'previousSibling') && !nextToInline(el, 'nextSibling')) el.remove();
  }

  convertWordLists(root);

  for (const pre of [...root.querySelectorAll('pre')]) {
    if (pre.parentNode && !pre.parentNode.closest('pre')) fixPre(pre);
  }

  for (const b of [...root.querySelectorAll('b[id^="docs-internal-guid"]')]) unwrap(b);

  normalizeFigures(root);

  for (const el of [...root.querySelectorAll('font')]) {
    const color = el.getAttribute('color');
    if (color) {
      const span = doc.createElement('span');
      span.setAttribute('style', 'color:' + color);
      while (el.firstChild) span.appendChild(el.firstChild);
      el.parentNode.replaceChild(span, el);
    } else {
      unwrap(el);
    }
  }

  for (const h of [...root.querySelectorAll('h5,h6')]) rename(h, 'h4');
  for (const c of [...root.querySelectorAll('center')]) {
    const n = rename(c, 'div');
    n.setAttribute('style', 'text-align:center');
  }
  inheritAlignment(root, null);

  for (const el of [...root.querySelectorAll('*')]) {
    if (!el.parentNode || el.closest('pre')) continue;
    const st = styleMap(el);
    const tag = el.tagName;
    const keep = [];
    const align = textAlignOf(el);
    if (ALIGN_TARGETS.has(tag) && align) keep.push('text-align:' + align);
    if (tag === 'SPAN' || tag === 'A' || tag === 'STRONG' || tag === 'B' || tag === 'EM' || tag === 'I' || tag === 'U' || tag === 'S') {
      if (st.color) {
        const c = keepAllColors ? (parseColor(st.color) ? st.color : null) : vividColor(st.color);
        if (c) keep.push('color:' + c);
      }
      const bg = st['background-color'] || st.background;
      if (keepAllColors && bg && parseColor(bg)) keep.push('background-color:' + bg);
      const fw = (st['font-weight'] || '').toLowerCase();
      if ((tag === 'B' || tag === 'STRONG') && (fw === 'normal' || fw === '400')) keep.push('font-weight:normal');
      if (tag === 'SPAN') {
        const td = (st['text-decoration'] || st['text-decoration-line'] || '').toLowerCase();
        const va = (st['vertical-align'] || '').toLowerCase();
        const wraps = [];
        if (fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600) wraps.push('strong');
        if (/italic/i.test(st['font-style'] || '')) wraps.push('em');
        if (td.includes('underline')) wraps.push('u');
        if (td.includes('line-through')) wraps.push('s');
        if (va === 'super') wraps.push('sup');
        else if (va === 'sub') wraps.push('sub');
        for (const w of wraps) {
          const x = doc.createElement(w);
          while (el.firstChild) x.appendChild(el.firstChild);
          el.appendChild(x);
        }
      }
    }
    if ((tag === 'TD' || tag === 'TH') && !el.hasAttribute('data-bg')) {
      const fill = st['background-color'] || st.background || el.getAttribute('bgcolor');
      const id = fill ? cellColorId(fill.split(/\s+(?![^(]*\))/)[0]) : null;
      if (id) el.setAttribute('data-bg', id);
    }
    if (tag === 'FIGURE' || tag === 'IMG' || tag === 'TD' || tag === 'TH' || tag === 'TABLE' || tag === 'COL') {
      const sw = st.width;
      if (tag === 'IMG' && sw && /(px|%)$/.test(sw)) keep.push('width:' + sw);
      if (tag === 'FIGURE' && el.hasAttribute('data-sized') && sw) keep.push('width:' + sw);
    }
    if (keep.length) el.setAttribute('style', keep.join(';'));
    else el.removeAttribute('style');
    for (const attr of [...el.attributes]) {
      const name = attr.name;
      if (name === 'style' || name === 'class' || name === 'href' || name === 'src' || name === 'alt' || name === 'colspan' || name === 'rowspan' || name === 'start' || name === 'type' || name === 'checked' || name === 'width' || name === 'height') continue;
      if (/^data-(type|checked|align|width|sized|emoji|color|provider|bg|indent|language|lang|colwidth|pm-slice)$/.test(name)) continue;
      el.removeAttribute(name);
    }
  }

  for (const a of [...root.querySelectorAll('a')]) {
    const href = (a.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#') || /^(javascript|vbscript|data):/i.test(href) || /^file:/i.test(href)) unwrap(a);
  }

  for (const b of [...root.querySelectorAll('b,strong')]) {
    if ((b.getAttribute('style') || '').includes('font-weight:normal')) unwrap(b);
  }

  for (const sp of [...root.querySelectorAll('span')]) {
    if (!sp.getAttribute('style')) unwrap(sp);
  }

  for (const div of [...root.querySelectorAll('div,section,article,header,footer,main,aside')]) {
    if (!div.parentNode) continue;
    const cls = div.getAttribute('class') || '';
    if (/\b(callout|doc-embed|video-embed|tableWrapper|table-wrap)\b/.test(cls)) continue;
    const align = textAlignOf(div);
    if (!hasBlockChild(div)) {
      const p = rename(div, 'p');
      p.removeAttribute('class');
      if (align) p.setAttribute('style', 'text-align:' + align);
      else p.removeAttribute('style');
    } else {
      // Text inside a div starts on its own line, so it must not merge with text outside once the div is unwrapped.
      wrapLooseInline(div);
    }
  }

  for (const div of [...root.querySelectorAll('div,section,article,header,footer,main,aside,figcaption')]) {
    if (!div.parentNode) continue;
    if (/\b(callout|doc-embed|video-embed)\b/.test(div.getAttribute('class') || '')) continue;
    if (div.tagName === 'FIGCAPTION' && div.parentNode.tagName === 'FIGURE') continue;
    unwrap(div);
  }

  // An inline wrapper around blocks (e.g. <span style=color><p>…</p></span>) never styled those blocks on the page.
  const BLOCK_INSIDE = 'p,h1,h2,h3,h4,h5,h6,ul,ol,li,table,blockquote,pre,figure,div,hr';
  for (const el of [...root.querySelectorAll('*')].reverse()) {
    if (el.parentNode && INLINE_TAGS.has(el.tagName) && !EMPTY_OK.has(el.tagName) && el.querySelector(BLOCK_INSIDE)) unwrap(el);
  }

  liftBlocks(root);

  for (const li of [...root.querySelectorAll('li')]) {
    if (li.getAttribute('data-type') === 'taskItem') continue;
    const cb = li.querySelector(':scope > input[type="checkbox"]');
    if (cb) {
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', cb.hasAttribute('checked') ? 'true' : 'false');
      if (li.parentNode) li.parentNode.setAttribute('data-type', 'taskList');
      cb.remove();
    }
  }

  removeEmptyInlines(root);
  for (const c of [root, ...root.querySelectorAll('li, td, th, blockquote, div.callout')]) {
    if (c === root || textAlignOf(c) || c.querySelector(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > ul, :scope > ol, :scope > table, :scope > figure, :scope > img, :scope > pre, :scope > blockquote, :scope > hr, :scope > div')) wrapLooseInline(c);
  }
  for (const block of [...root.querySelectorAll('p,h1,h2,h3,h4,li,td,th,blockquote')]) removeTrailingBr(block);

  if (collapseEmpty) {
    for (const h of [...root.querySelectorAll('h1,h2,h3,h4')]) {
      if (!hasContent(h)) h.remove();
    }
    collapseEmptyParas(root);
    for (const q of root.querySelectorAll('blockquote,td,th,li')) {
      const kids = [...q.children];
      if (kids.length > 1) for (const k of kids) if (isEmptyPara(k) && q.children.length > 1) k.remove();
    }
  }

  return root;
}
