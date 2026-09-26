import { Node, Extension, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { lowlight, languageLabel, resolveLanguage } from './lowlight.js';

export const CELL_COLORS = [
  { id: 'red', label: '红', value: 'rgba(255,92,122,.18)' },
  { id: 'orange', label: '橙', value: 'rgba(255,159,67,.18)' },
  { id: 'yellow', label: '黄', value: 'rgba(255,230,0,.14)' },
  { id: 'green', label: '绿', value: 'rgba(61,220,151,.16)' },
  { id: 'cyan', label: '青', value: 'rgba(0,245,255,.13)' },
  { id: 'blue', label: '蓝', value: 'rgba(77,159,255,.18)' },
  { id: 'purple', label: '紫', value: 'rgba(179,136,255,.18)' },
  { id: 'gray', label: '灰', value: 'rgba(140,165,190,.16)' },
];
const CELL_COLOR_BY_ID = Object.fromEntries(CELL_COLORS.map(c => [c.id, c.value]));

const cellBackground = {
  background: {
    default: null,
    parseHTML: el => {
      const id = el.getAttribute('data-bg');
      return id && CELL_COLOR_BY_ID[id] ? id : null;
    },
    renderHTML: attrs => attrs.background && CELL_COLOR_BY_ID[attrs.background]
      ? { 'data-bg': attrs.background, style: `background-color:${CELL_COLOR_BY_ID[attrs.background]}` }
      : {},
  },
};

export const DocTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground };
  },
});

export const DocTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground };
  },
});

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: el => clampInt(el.getAttribute('data-indent') || 0, 0, 6),
          renderHTML: attrs => (attrs.indent ? { 'data-indent': String(attrs.indent) } : {}),
        },
      },
    }];
  },
});

function numAttr(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function figureAttrsFromImg(img, figure) {
  const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
  let alt = (img.getAttribute('alt') || '').trim();
  if (/^(图片|image|img|封面|picture|photo)$/i.test(alt)) alt = '';
  const capEl = figure ? figure.querySelector('figcaption') : null;
  const caption = capEl ? capEl.textContent.replace(/\s+/g, ' ').trim() : '';
  let width = null;
  const dw = figure && figure.getAttribute('data-width');
  if (dw) width = numAttr(dw);
  if (!width && figure && figure.hasAttribute('data-sized')) {
    const m = /width:\s*([\d.]+)%/.exec(figure.getAttribute('style') || '');
    if (m) width = Math.round(parseFloat(m[1]));
  }
  if (!width) {
    const sw = (img.getAttribute('style') || '').match(/(?:^|;)\s*width:\s*([\d.]+)(px|%)/);
    if (sw) {
      const v = parseFloat(sw[1]);
      width = sw[2] === '%' ? Math.round(v) : Math.round(Math.min(100, (v / 720) * 100));
    }
  }
  if (width && (width < 5 || width > 100)) width = null;
  const align = figure && ['left', 'right', 'center'].includes(figure.getAttribute('data-align'))
    ? figure.getAttribute('data-align') : 'center';
  return {
    src,
    alt,
    caption,
    width,
    align,
    naturalWidth: numAttr(img.getAttribute('width')),
    naturalHeight: numAttr(img.getAttribute('height')),
  };
}

export const Figure = Node.create({
  name: 'figure',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    // Values come from the parse rules' getAttrs; per-attribute parsing would re-read raw <img> attributes.
    const attr = def => ({ default: def, parseHTML: () => null, rendered: false });
    return {
      src: attr(''),
      alt: attr(''),
      caption: attr(''),
      width: attr(null),
      align: attr('center'),
      naturalWidth: attr(null),
      naturalHeight: attr(null),
    };
  },
  parseHTML() {
    return [
      {
        tag: 'figure',
        getAttrs: el => {
          const img = el.querySelector('img');
          return img ? figureAttrsFromImg(img, el) : false;
        },
      },
      { tag: 'img[src]', getAttrs: img => figureAttrsFromImg(img, null) },
    ];
  },
  renderHTML({ node }) {
    return figureDOMSpec(node.attrs);
  },
});

export function figureDOMSpec(a) {
  const fig = { class: 'doc-figure', 'data-align': a.align || 'center' };
  if (a.width) {
    fig['data-sized'] = '';
    fig.style = `width:${a.width}%`;
  }
  const img = { src: a.src || '', alt: a.alt || '', decoding: 'async' };
  // Without a known size a lazy image has no height until it loads, so the text below it jumps.
  if (a.naturalWidth && a.naturalHeight) {
    img.width = String(a.naturalWidth);
    img.height = String(a.naturalHeight);
    img.loading = 'lazy';
  }
  return a.caption
    ? ['figure', fig, ['img', img], ['figcaption', {}, a.caption]]
    : ['figure', fig, ['img', img]];
}

export const CALLOUT_COLORS = ['cyan', 'magenta', 'yellow', 'green', 'purple', 'gray'];

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      emoji: {
        default: '💡',
        parseHTML: el => el.getAttribute('data-emoji') || '💡',
        renderHTML: attrs => ({ 'data-emoji': attrs.emoji || '💡' }),
      },
      color: {
        default: 'cyan',
        parseHTML: el => (CALLOUT_COLORS.includes(el.getAttribute('data-color')) ? el.getAttribute('data-color') : 'cyan'),
        renderHTML: attrs => ({ 'data-color': attrs.color || 'cyan' }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div.callout' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ class: 'callout' }, HTMLAttributes), 0];
  },
});

export function embedFromUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^www\.|^m\./, '');
  if (host === 'player.bilibili.com') return { provider: 'bilibili', src: url.href.replace(/^http:/, 'https:') };
  if (host === 'bilibili.com' || host === 'b23.tv') {
    const bv = /\/video\/(BV[0-9A-Za-z]{10})/.exec(url.pathname);
    const av = /\/video\/av(\d+)/i.exec(url.pathname);
    const page = url.searchParams.get('p') || '1';
    if (bv) return { provider: 'bilibili', src: `https://player.bilibili.com/player.html?bvid=${bv[1]}&page=${page}&autoplay=0` };
    if (av) return { provider: 'bilibili', src: `https://player.bilibili.com/player.html?aid=${av[1]}&page=${page}&autoplay=0` };
  }
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let id = null;
    if (host === 'youtu.be') id = url.pathname.slice(1);
    else if (url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2];
    else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2];
    else id = url.searchParams.get('v');
    if (id && /^[\w-]{6,}$/.test(id)) return { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === 'itch.io' && url.pathname.startsWith('/embed')) return { provider: 'itch', src: url.href };
  return { provider: 'web', src: url.href };
}

export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: '', parseHTML: () => null, rendered: false },
      provider: { default: 'web', parseHTML: () => null, rendered: false },
    };
  },
  parseHTML() {
    const fromIframe = iframe => {
      const src = iframe && iframe.getAttribute('src');
      if (!src) return false;
      const abs = src.startsWith('//') ? 'https:' + src : src;
      const info = embedFromUrl(abs);
      return info || false;
    };
    return [
      { tag: 'div.doc-embed', getAttrs: el => fromIframe(el.querySelector('iframe')) },
      { tag: 'div.video-embed', getAttrs: el => fromIframe(el.querySelector('iframe')) },
      { tag: 'iframe[src]', getAttrs: el => fromIframe(el) },
    ];
  },
  renderHTML({ node }) {
    return embedDOMSpec(node.attrs);
  },
});

export function embedDOMSpec(a) {
  return ['div', { class: 'doc-embed', 'data-provider': a.provider || 'web' },
    ['iframe', {
      src: a.src || '',
      loading: 'lazy',
      allowfullscreen: 'true',
      allow: 'fullscreen; picture-in-picture; encrypted-media',
      referrerpolicy: 'strict-origin-when-cross-origin',
      frameborder: '0',
    }]];
}

export const DocCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      language: {
        default: 'plaintext',
        parseHTML: el => {
          const code = el.querySelector('code') || el;
          const cls = [...(code.classList || [])].find(c => c.startsWith('language-') || c.startsWith('lang-'));
          const fromClass = cls ? resolveLanguage(cls.replace(/^lang(uage)?-/, '')) : null;
          return fromClass || resolveLanguage(el.getAttribute('data-language')) || 'plaintext';
        },
        rendered: false,
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const lang = node.attrs.language || 'plaintext';
    const label = languageLabel(lang);
    const preAttrs = label ? { 'data-lang': label } : {};
    return ['pre', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, preAttrs),
      ['code', { class: `language-${lang}` }, 0]];
  },
}).configure({ lowlight, defaultLanguage: 'plaintext', enableTabIndentation: true, tabSize: 2 });

function nullWhenEmpty(ext) {
  return ext.extend({
    addGlobalAttributes() {
      return (this.parent?.() || []).map(group => ({
        ...group,
        attributes: Object.fromEntries(Object.entries(group.attributes).map(([name, spec]) => [
          name,
          { ...spec, parseHTML: el => (spec.parseHTML ? spec.parseHTML(el) : null) || null },
        ])),
      }));
    },
  });
}

const DocColor = nullWhenEmpty(Color);
const DocBackgroundColor = nullWhenEmpty(BackgroundColor);
// The color span must sit inside <strong>/<em>/<a>, whose theme colors would otherwise override it.
const DocTextStyle = TextStyle.extend({ priority: 99 });

export const LINK_ATTRS = { target: '_blank', rel: 'noopener noreferrer' };

export function baseExtensions({ editing = false } = {}) {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { ...LINK_ATTRS, class: null },
      },
      undoRedo: editing ? { depth: 300, newGroupDelay: 600 } : false,
      dropcursor: editing ? { color: '#00f5ff', width: 2 } : false,
      trailingNode: false,
    }),
    DocTextStyle,
    DocColor,
    DocBackgroundColor,
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    Superscript,
    Subscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: editing, renderWrapper: true, cellMinWidth: 25, allowTableNodeSelection: true, lastColumnResizable: false }),
    TableRow,
    DocTableHeader,
    DocTableCell,
    DocCodeBlock,
    Figure,
    Callout,
    Embed,
    Indent,
  ];
}
