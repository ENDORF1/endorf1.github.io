import { getSchema } from '@tiptap/core';
import { DOMSerializer, DOMParser as PMDOMParser, Node as PMNode } from '@tiptap/pm/model';
import { baseExtensions } from './extensions.js';
import { highlightSegments } from './lowlight.js';
import { normalizeHTML } from './normalize.js';

let schemaCache = null;

export function docSchema() {
  if (!schemaCache) schemaCache = getSchema(baseExtensions({ editing: false }));
  return schemaCache;
}

export const EMPTY_DOC = Object.freeze({ type: 'doc', content: [{ type: 'paragraph' }] });

export function emptyDoc() {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** The editor's placeholder line: a document holding a single empty paragraph. */
export function isBlankDoc(node) {
  return node.childCount === 1 && node.firstChild.type.name === 'paragraph' && node.firstChild.content.size === 0;
}

export function toNode(json) {
  const schema = docSchema();
  try {
    return PMNode.fromJSON(schema, json && json.type === 'doc' ? json : emptyDoc());
  } catch (e) {
    console.warn('invalid doc json, falling back to lenient parse', e);
    return PMNode.fromJSON(schema, emptyDoc());
  }
}

const MARK_TAGS = new Set(['STRONG', 'EM', 'U', 'S', 'CODE', 'A', 'SPAN', 'SUP', 'SUB', 'MARK', 'B', 'I']);

function needsTrailingBreak(block) {
  let node = block.lastChild;
  while (node && node.nodeType === 1 && MARK_TAGS.has(node.tagName)) node = node.lastChild;
  if (!node) return true;
  if (node.nodeType !== 3) return true;
  return /\n$/.test(node.data);
}

export function headingSlug(text) {
  return String(text).trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

/**
 * Serialises a document exactly the way the editor lays it out: same schema, same
 * code highlighting, and the same trailing <br> ProseMirror adds to empty or
 * break-terminated textblocks.
 */
export function renderDocHTML(json, doc) {
  const node = toNode(json);
  if (isBlankDoc(node)) return '';
  const serializer = DOMSerializer.fromSchema(docSchema());
  const wrap = doc.createElement('div');
  wrap.appendChild(serializer.serializeFragment(node.content, { document: doc }));

  for (const code of wrap.querySelectorAll('pre > code')) {
    const m = /(?:^|\s)language-(\S+)/.exec(code.getAttribute('class') || '');
    const lang = m ? m[1] : 'plaintext';
    const text = code.textContent;
    while (code.firstChild) code.removeChild(code.firstChild);
    for (const seg of highlightSegments(text, lang)) {
      if (seg.classes.length) {
        const span = doc.createElement('span');
        span.setAttribute('class', seg.classes.join(' '));
        span.textContent = seg.text;
        code.appendChild(span);
      } else {
        code.appendChild(doc.createTextNode(seg.text));
      }
    }
    if (!text || text.endsWith('\n')) code.appendChild(doc.createElement('br'));
  }

  for (const el of wrap.querySelectorAll('p, h1, h2, h3, h4')) {
    if (needsTrailingBreak(el)) el.appendChild(doc.createElement('br'));
  }

  const used = new Map();
  for (const h of wrap.querySelectorAll('h1, h2, h3, h4')) {
    const base = headingSlug(h.textContent);
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    h.setAttribute('id', n === 1 ? base : `${base}-${n}`);
  }

  return wrap.innerHTML;
}

export function parseHTMLToDoc(html, doc, { normalize = true, keepAllColors = false, collapseEmpty = true } = {}) {
  const container = normalize
    ? normalizeHTML(html, { doc, keepAllColors, collapseEmpty })
    : (() => { const d = doc.createElement('div'); d.innerHTML = html; return d; })();
  const parsed = PMDOMParser.fromSchema(docSchema()).parse(container);
  const json = parsed.toJSON();
  if (!json.content || !json.content.length) return emptyDoc();
  return json;
}

export function docText(json) {
  return toNode(json).textBetween(0, toNode(json).content.size, '\n', ' ');
}

export function docPlainText(json) {
  const node = toNode(json);
  return node.textBetween(0, node.content.size, '\n', '\n');
}

export function docImages(json) {
  const out = [];
  toNode(json).descendants(n => {
    if (n.type.name === 'figure' && n.attrs.src) out.push(n.attrs.src);
  });
  return out;
}

export function docHeadings(json) {
  const out = [];
  toNode(json).descendants((n, pos) => {
    if (n.type.name === 'heading') out.push({ level: n.attrs.level, text: n.textContent, pos });
    return n.type.name !== 'heading';
  });
  return out;
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;

export function countWords(text) {
  const cjk = (text.match(CJK) || []).length;
  const latin = (text.replace(CJK, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  return cjk + latin;
}

export function excerpt(json, max = 120) {
  const t = docPlainText(json).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
