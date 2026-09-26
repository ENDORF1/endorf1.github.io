import { Editor } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { TextSelection } from '@tiptap/pm/state';
import { render, h } from 'preact';
import { marked } from 'marked';
import { baseExtensions } from '../shared/extensions.js';
import { normalizeHTML } from '../shared/normalize.js';
import { resolveLanguage } from '../shared/lowlight.js';
import { docHeadings, countWords, docPlainText, isBlankDoc } from '../shared/render.js';
import { normLayout, layoutStyle, debounce } from '../shared/util.js';
import {
  renderPostPage, renderWorkPage, renderGalleryItemPage, renderAboutPage,
  postHeaderHTML, postCoverHTML, workHeaderHTML, workMediaHTML, workLinkHTML,
  galleryHeaderHTML, galleryMediaHTML,
} from '../shared/templates.js';
import { createStore } from './store.js';
import { SlashCommand } from './ext/slash.js';
import { FindReplace } from './ext/find.js';
import { EditableFigure, EditableEmbed, nodeViewFor } from './ext/nodeviews.js';
import { EditorKeys } from './ext/keys.js';
import { PasteHandler } from './ext/paste.js';
import { blockAt, insertBlocks, insertFigures } from './commands.js';
import { EditorUI } from './ui/EditorUI.jsx';

const EDIT_OPTS = { css: '', mode: 'edit' };

function editPageHTML(kind, meta, cat) {
  if (kind === 'post') return renderPostPage(meta, '', EDIT_OPTS);
  if (kind === 'work') return renderWorkPage(meta, '', EDIT_OPTS);
  if (kind === 'galleryItem') return renderGalleryItemPage(cat, meta, '', EDIT_OPTS);
  return renderAboutPage(meta, '', EDIT_OPTS);
}

function zoneHTML(kind, zone, meta, cat) {
  if (kind === 'post') {
    if (zone === 'header') return postHeaderHTML(meta, 'edit');
    if (zone === 'cover') return postCoverHTML(meta, 'edit');
  } else if (kind === 'work') {
    if (zone === 'header') return workHeaderHTML(meta, 'edit');
    if (zone === 'media') return workMediaHTML(meta, 'edit');
    if (zone === 'link') return workLinkHTML(meta, 'edit');
  } else if (kind === 'galleryItem') {
    if (zone === 'header') return galleryHeaderHTML(cat, meta, 'edit');
    if (zone === 'media') return galleryMediaHTML(meta, 'edit');
  }
  return null;
}

function runScripts(root) {
  for (const old of root.querySelectorAll('script')) {
    const s = document.createElement('script');
    s.textContent = old.textContent;
    old.replaceWith(s);
  }
}

export class EditorApp {
  constructor(host) {
    this.host = host;
    this.editor = null;
    this.doc = null;
    this.store = createStore({
      tick: 0, loaded: false, docId: null, kind: null, meta: null, cat: null, readOnly: false,
      hover: null, menu: null, slash: null, find: null, embedPrompt: null, busy: null, dragging: false, typing: false,
    });
    this.bumpQueued = false;
    this.pendingTitle = null;
    this.saveBody = debounce(() => this.emitBody(), 350);
    this.emitTitle = debounce(() => {
      if (this.pendingTitle == null || !this.doc) return;
      const title = this.pendingTitle;
      this.pendingTitle = null;
      this.doc.meta = { ...this.doc.meta, title };
      this.host.metaChanged(this.doc.docId, { title });
    }, 250);
    this.slash = this.createSlashController();
    this.uiRoot = document.getElementById('ui-root');
    this.bindDocumentEvents();
    render(h(EditorUI, { app: this }), this.uiRoot);
  }

  /* ---------------- lifecycle ---------------- */

  load({ docId, kind, meta, cat = null, body, readOnly = false, focus = null, scrollTop = 0 }) {
    this.flush();
    this.destroyEditor();
    this.doc = { docId, kind, meta: { ...meta }, cat: cat ? { ...cat } : null };
    this.store.set({ loaded: false, docId, kind, meta: this.doc.meta, cat: this.doc.cat, readOnly, hover: null, menu: null, slash: null, find: null, embedPrompt: null });
    document.body.classList.add('is-loading');
    this.renderPage();
    const mount = document.querySelector('[data-mount="body"]');
    const cls = mount.className;
    this.editor = new Editor({
      element: { mount },
      injectCSS: false,
      editable: !readOnly,
      content: body || { type: 'doc', content: [{ type: 'paragraph' }] },
      extensions: this.extensions(),
      editorProps: {
        attributes: { class: cls, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' },
        handleDOMEvents: {
          mousedown: (view, e) => this.onEditorMouseDown(view, e),
        },
        scrollThreshold: { top: 80, bottom: 80, left: 0, right: 0 },
        scrollMargin: { top: 90, bottom: 60, left: 0, right: 0 },
      },
      onTransaction: ({ transaction }) => {
        if (transaction.docChanged) {
          this.saveBody();
          const menu = this.store.get().menu;
          const patch = { typing: true, hover: null };
          if (menu && (menu.type === 'pasteUrl' || menu.type === 'block')) patch.menu = null;
          this.store.set(patch);
        }
        this.bump();
      },
      onFocus: () => this.bump(),
      onBlur: () => this.bump(),
    });
    window.scrollTo(0, scrollTop || 0);
    requestAnimationFrame(() => {
      document.body.classList.remove('is-loading');
      this.store.set({ loaded: true });
      this.emitStats();
      if (focus === 'title') this.focusTitle('end');
      else if (focus === 'end') this.editor.commands.focus('end');
      else if (focus === 'start') this.editor.commands.focus('start');
    });
  }

  extensions() {
    const base = baseExtensions({ editing: true }).map(ext => {
      if (ext.name === 'figure') return EditableFigure(this);
      if (ext.name === 'embed') return EditableEmbed(this);
      return ext;
    });
    return [
      ...base,
      Placeholder.configure({
        showOnlyCurrent: true,
        includeChildren: false,
        placeholder: ({ node, editor }) => {
          if (node.type.name === 'heading') return `${['', '一', '二', '三', '四'][node.attrs.level] || ''}级标题`;
          if (node.type.name === 'paragraph') return editor.isEmpty ? '开始输入正文，输入“/”唤起菜单' : '输入“/”快速插入';
          return '';
        },
      }),
      SlashCommand(this),
      FindReplace,
      EditorKeys(this),
      PasteHandler(this),
    ];
  }

  destroyEditor() {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  }

  unload() {
    this.flush();
    this.destroyEditor();
    this.doc = null;
    const ui = this.uiRoot;
    for (const n of [...document.body.childNodes]) if (n !== ui) n.remove();
    document.body.className = 'is-editing';
    this.store.set({ loaded: false, docId: null, kind: null, meta: null, cat: null, hover: null, menu: null, slash: null, find: null });
  }

  flush() {
    this.saveBody.flush();
    this.emitTitle.flush();
  }

  emitBody() {
    if (!this.editor || !this.doc) return;
    const json = this.editor.getJSON();
    this.host.bodyChanged(this.doc.docId, json);
    this.emitStats(json);
  }

  emitStats(json = this.editor && this.editor.getJSON()) {
    if (!json || !this.doc) return;
    const text = docPlainText(json);
    this.host.statsChanged(this.doc.docId, {
      words: countWords(text),
      chars: text.replace(/\s/g, '').length,
      headings: docHeadings(json),
    });
  }

  bump() {
    if (this.bumpQueued) return;
    this.bumpQueued = true;
    requestAnimationFrame(() => {
      this.bumpQueued = false;
      this.store.set(s => ({ tick: s.tick + 1 }));
    });
  }

  /* ---------------- page chrome ---------------- */

  renderPage() {
    const { kind, meta, cat } = this.doc;
    const parsed = new DOMParser().parseFromString(editPageHTML(kind, meta, cat), 'text/html');
    const keep = [...document.body.classList].filter(c => c === 'mod-down' || c === 'is-loading');
    document.body.className = [parsed.body.className, ...keep].join(' ');
    const ui = this.uiRoot;
    for (const n of [...document.body.childNodes]) if (n !== ui) n.remove();
    for (const n of [...parsed.body.childNodes]) {
      if (n.nodeType === 1 && n.id === 'ui-root') continue;
      document.body.insertBefore(document.adoptNode(n), ui);
    }
    runScripts(document.body);
    this.titleEl = document.querySelector('[data-field="title"]');
    if (this.titleEl) this.bindTitle(this.titleEl);
  }

  /** Re-renders the page chrome around the body when page fields change. */
  renderZones() {
    if (!this.doc) return;
    const { kind, meta, cat } = this.doc;
    const wrap = document.querySelector('.page-wrap');
    if (wrap) wrap.setAttribute('style', layoutStyle(normLayout(meta.layout, kind)));
    for (const zone of document.querySelectorAll('[data-zone]')) {
      const html = zoneHTML(kind, zone.getAttribute('data-zone'), meta, cat);
      if (html == null) continue;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const liveTitle = zone.querySelector('[data-field="title"]');
      const newTitle = tmp.querySelector('[data-field="title"]');
      if (liveTitle && newTitle) {
        if (liveTitle.textContent !== newTitle.textContent && document.activeElement !== liveTitle) liveTitle.textContent = newTitle.textContent;
        newTitle.replaceWith(liveTitle);
      }
      const before = zone.innerHTML;
      if (before === tmp.innerHTML) continue;
      zone.replaceChildren(...tmp.childNodes);
      runScripts(zone);
    }
    this.bump();
  }

  setMeta(meta, cat) {
    if (!this.doc) return;
    const titleFocused = this.titleEl && document.activeElement === this.titleEl;
    this.doc.meta = { ...meta, title: titleFocused && this.pendingTitle != null ? this.pendingTitle : meta.title };
    if (cat !== undefined) this.doc.cat = cat;
    this.store.set({ meta: this.doc.meta, cat: this.doc.cat });
    if (this.titleEl && !titleFocused && this.titleEl.textContent !== (meta.title || '')) this.titleEl.textContent = meta.title || '';
    this.renderZones();
  }

  patchMeta(patch) {
    if (!this.doc) return;
    this.doc.meta = { ...this.doc.meta, ...patch };
    this.store.set({ meta: this.doc.meta });
    this.host.metaChanged(this.doc.docId, patch);
    this.renderZones();
  }

  bindTitle(el) {
    el.addEventListener('input', () => {
      let text = el.textContent;
      if (/[\r\n]/.test(text) || el.children.length) {
        text = text.replace(/[\r\n]+/g, ' ');
        el.textContent = text;
        placeCaretAtEnd(el);
      }
      this.pendingTitle = text.trim();
      this.emitTitle();
    });
    el.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'Enter' || (e.key === 'ArrowDown' && caretAtEnd(el)) || e.key === 'Tab') {
        e.preventDefault();
        const rest = e.key === 'Enter' ? takeTextAfterCaret(el) : '';
        if (rest) {
          this.pendingTitle = el.textContent.trim();
          this.emitTitle();
        }
        this.emitTitle.flush();
        if (!this.editor) return;
        if (rest) {
          const first = this.editor.state.doc.firstChild;
          const blank = first && first.type.name === 'paragraph' && !first.content.size;
          // Undo can't put the text back into the title, so keep this step out of the history instead of losing it.
          this.editor.chain()
            .command(({ tr }) => { tr.setMeta('addToHistory', false); return true; })
            .insertContentAt(blank ? { from: 1, to: 1 } : 0, blank ? rest : { type: 'paragraph', content: [{ type: 'text', text: rest }] })
            .setTextSelection(1)
            .run();
        }
        this.editor.commands.focus('start');
        // Tiptap moves DOM focus on the next frame; keys typed before then would still land in the title.
        this.editor.view.focus();
      }
    });
    el.addEventListener('blur', () => this.emitTitle.flush());
    el.addEventListener('paste', e => {
      e.preventDefault();
      const text = (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, text);
    });
  }

  focusTitle(where = 'end') {
    const el = this.titleEl;
    if (!el) return false;
    el.focus();
    if (where === 'end') placeCaretAtEnd(el);
    return true;
  }

  /* ---------------- document events ---------------- */

  bindDocumentEvents() {
    let hoverFrame = 0;
    let lastMouse = null;
    document.addEventListener('mousemove', e => {
      lastMouse = e;
      if (this.store.get().typing) this.store.set({ typing: false });
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        this.updateHover(lastMouse);
      });
    }, { passive: true });
    document.addEventListener('mouseleave', () => {
      if (!this.store.get().menu) this.store.set({ hover: null });
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Control' || e.key === 'Meta') document.body.classList.add('mod-down');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        this.flush();
        this.host.shortcut('save');
      } else if (mod && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        this.flush();
        this.host.shortcut('preview');
      } else if (mod && (e.key === '\\')) {
        e.preventDefault();
        this.host.shortcut('toggleSidebar');
      } else if (mod && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        this.host.shortcut('help');
      } else if (mod && !e.shiftKey && (e.key === 'f' || e.key === 'F') && !(this.editor && this.editor.view.hasFocus())) {
        e.preventDefault();
        this.openFind(false);
      } else if (e.key === 'Escape') {
        this.closeTransient();
      }
    }, true);
    document.addEventListener('keyup', e => {
      if (e.key === 'Control' || e.key === 'Meta') document.body.classList.remove('mod-down');
    });
    window.addEventListener('blur', () => document.body.classList.remove('mod-down'));

    document.addEventListener('click', e => this.onDocumentClick(e), true);
    document.addEventListener('mousedown', e => this.onDocumentMouseDown(e));
    document.addEventListener('mousedown', e => {
      if (e.button === 0 && this.editor && this.editor.view.dom.contains(e.target)) this.store.set({ selecting: true });
    }, true);
    document.addEventListener('mouseup', () => {
      if (this.store.get().selecting) this.store.set({ selecting: false });
    }, true);

    document.addEventListener('dragover', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      document.body.classList.add('is-file-drag');
    });
    document.addEventListener('dragleave', e => {
      if (e.target === document.documentElement || !e.relatedTarget) document.body.classList.remove('is-file-drag');
    });
    document.addEventListener('drop', e => {
      document.body.classList.remove('is-file-drag');
      if (!hasFiles(e)) return;
      const handled = e.defaultPrevented;
      e.preventDefault();
      if (handled) return;
      const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
      if (!files.length || !this.editor) return;
      const pos = this.posNear(e.clientX, e.clientY);
      this.insertImageFiles(files, pos);
    });
    document.addEventListener('dragend', () => this.store.set({ dragging: false }));

    window.addEventListener('resize', () => this.bump());
    document.addEventListener('scroll', () => {
      if (this.store.get().hover && lastMouse) this.updateHover(lastMouse);
    }, { passive: true });
  }

  onDocumentClick(e) {
    const a = e.target.closest && e.target.closest('a[href]');
    if (a) {
      const inDoc = this.editor && this.editor.view.dom.contains(a);
      if (!inDoc || !(e.ctrlKey || e.metaKey)) e.preventDefault();
      if (inDoc && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.host.openExternal(a.getAttribute('href'));
        return;
      }
    }
    if (e.target.closest && e.target.closest('.play-launch')) e.preventDefault();
    const field = e.target.closest && e.target.closest('[data-field]');
    if (field && field.getAttribute('data-field') !== 'title' && !this.store.get().readOnly) {
      e.preventDefault();
      e.stopPropagation();
      const name = field.getAttribute('data-field');
      this.openField(name === 'meta' ? 'tags' : name, field);
    }
  }

  onDocumentMouseDown(e) {
    if (!this.editor || e.button !== 0) return;
    if (this.uiRoot.contains(e.target)) return;
    const view = this.editor.view;
    if (view.dom.contains(e.target)) return;
    if (e.target.closest('[data-field], nav, .nav-btns, .play-shell, .gd-canvas')) return;
    const rect = view.dom.getBoundingClientRect();
    if (e.clientY > rect.bottom) {
      e.preventDefault();
      this.appendParagraphAtEnd();
    } else if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
      const pos = view.posAtCoords({ left: Math.max(rect.left + 1, Math.min(e.clientX, rect.right - 1)), top: e.clientY });
      if (pos) {
        e.preventDefault();
        const $pos = view.state.doc.resolve(pos.pos);
        const sel = $pos.parent.inlineContent ? TextSelection.create(view.state.doc, pos.pos) : TextSelection.near($pos);
        view.dispatch(view.state.tr.setSelection(sel));
        view.focus();
      }
    }
  }

  onEditorMouseDown(view, e) {
    if (e.button !== 0) return false;
    const callout = e.target.closest && e.target.closest('.callout');
    if (callout && view.dom.contains(callout)) {
      const r = callout.getBoundingClientRect();
      if (e.clientX < r.left + 46 && e.clientY < r.top + 46) {
        e.preventDefault();
        const pos = view.posAtDOM(callout, 0) - 1;
        this.openMenu({ type: 'callout', pos });
        return true;
      }
    }
    return false;
  }

  appendParagraphAtEnd() {
    const { state, view } = this.editor;
    const last = state.doc.lastChild;
    if (last && last.type.name === 'paragraph' && !last.content.size) {
      this.editor.commands.focus('end');
      return;
    }
    const end = state.doc.content.size;
    const tr = state.tr.insert(end, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, end + 1));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  posNear(x, y) {
    const view = this.editor.view;
    const rect = view.dom.getBoundingClientRect();
    const found = view.posAtCoords({ left: Math.max(rect.left + 1, Math.min(x, rect.right - 1)), top: Math.max(rect.top + 1, Math.min(y, rect.bottom - 1)) });
    return found ? found.pos : view.state.doc.content.size;
  }

  /* ---------------- block hover (handle) ---------------- */

  updateHeaderHover(e) {
    const zone = document.querySelector('[data-zone="header"]');
    let over = false;
    if (zone) {
      for (const child of zone.children) {
        const r = child.getBoundingClientRect();
        if (e.clientX >= r.left - 40 && e.clientX <= r.right + 40 && e.clientY >= r.top - 48 && e.clientY <= r.bottom + 12) over = true;
      }
    }
    if (over !== !!this.store.get().headerHover) this.store.set({ headerHover: over });
  }

  updateHover(e) {
    const st = this.store.get();
    if (!this.editor || !st.loaded || st.readOnly) return;
    this.updateHeaderHover(e);
    if (st.menu || st.dragging || st.slash) return;
    if (this.uiRoot.contains(e.target)) return;
    const view = this.editor.view;
    const rect = view.dom.getBoundingClientRect();
    const inX = e.clientX >= rect.left - 90 && e.clientX <= rect.right + 30;
    const inY = e.clientY >= rect.top - 4 && e.clientY <= rect.bottom + 4;
    if (!inX || !inY) {
      if (st.hover) this.store.set({ hover: null });
      return;
    }
    const found = view.posAtCoords({ left: Math.max(rect.left + 2, Math.min(e.clientX, rect.right - 2)), top: e.clientY });
    if (!found) return;
    const probe = found.inside >= 0 ? found.inside : found.pos;
    let target = blockAt(view.state, probe);
    if (found.inside >= 0) {
      const node = view.state.doc.nodeAt(found.inside);
      const $in = view.state.doc.resolve(found.inside);
      if (node && $in.depth === 0) target = { pos: found.inside, node, depth: 1 };
    }
    if (!target) return;
    const dom = view.nodeDOM(target.pos);
    if (!dom || dom.nodeType !== 1) return;
    const r = dom.getBoundingClientRect();
    let lineTop = r.top;
    let lineHeight = 24;
    if (target.node.isTextblock || target.node.type.name === 'listItem' || target.node.type.name === 'taskItem' || target.node.type.name === 'blockquote' || target.node.type.name === 'callout') {
      const c = firstLineRect(view, target);
      if (c) { lineTop = c.top; lineHeight = c.height; }
    }
    const hover = {
      pos: target.pos,
      type: target.node.type.name,
      left: Math.min(rect.left, r.left) + window.scrollX,
      itemLeft: r.left + window.scrollX,
      top: lineTop + window.scrollY,
      height: lineHeight,
      blockTop: r.top + window.scrollY,
      blockHeight: r.height,
      isList: target.depth > 1 || target.node.type.name === 'listItem' || target.node.type.name === 'taskItem',
    };
    const prev = st.hover;
    if (prev && prev.pos === hover.pos && prev.top === hover.top && prev.left === hover.left && prev.itemLeft === hover.itemLeft) return;
    this.store.set({ hover });
  }

  /* ---------------- menus ---------------- */

  openMenu(menu) {
    this.store.set({ menu });
  }

  closeMenu() {
    if (this.store.get().menu) this.store.set({ menu: null });
  }

  closeTransient() {
    const st = this.store.get();
    if (st.menu) { this.store.set({ menu: null }); return true; }
    if (st.embedPrompt) { this.store.set({ embedPrompt: null }); return true; }
    if (st.find) { this.closeFind(); return true; }
    return false;
  }

  openField(name, el) {
    this.store.set({ menu: { type: 'field', field: name, el } });
  }

  openLinkEditor() {
    if (!this.editor) return;
    const { state } = this.editor;
    if (state.selection.empty && !this.editor.isActive('link')) {
      this.host.toast('先选中要加链接的文字', 'info');
      return;
    }
    if (this.editor.isActive('link')) this.editor.commands.extendMarkRange('link');
    this.openMenu({ type: 'link', edit: true });
  }

  openFind(replace) {
    if (!this.editor) return;
    const { state } = this.editor;
    let query = '';
    if (!state.selection.empty) {
      const t = state.doc.textBetween(state.selection.from, state.selection.to, ' ');
      if (t.length < 80 && !t.includes('\n')) query = t;
    }
    const prev = this.store.get().find;
    this.store.set({ find: { replace: replace || (prev && prev.replace) || false, query: query || (prev ? prev.query : ''), focusTick: Date.now() } });
  }

  closeFind() {
    if (this.editor) this.editor.commands.clearFind();
    this.store.set({ find: null });
    if (this.editor) this.editor.commands.focus();
  }

  /* ---------------- slash menu ---------------- */

  createSlashController() {
    const app = this;
    let props = null;
    return {
      open(p) {
        props = p;
        app.store.set({ slash: { items: p.items, index: 0, query: p.query, getRect: p.clientRect }, hover: null, menu: null });
      },
      update(p) {
        props = p;
        const prev = app.store.get().slash;
        const index = prev && prev.query === p.query ? Math.min(prev.index, Math.max(0, p.items.length - 1)) : 0;
        app.store.set({ slash: { items: p.items, index, query: p.query, getRect: p.clientRect } });
      },
      close() {
        props = null;
        app.store.set({ slash: null });
      },
      select(i) {
        const st = app.store.get().slash;
        if (!props || !st || !st.items[i]) return;
        props.command(st.items[i]);
      },
      keydown(e) {
        const st = app.store.get().slash;
        if (!st) return false;
        if (!st.items.length) return false;
        if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
          app.store.set({ slash: { ...st, index: (st.index + 1) % st.items.length } });
          return true;
        }
        if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
          app.store.set({ slash: { ...st, index: (st.index - 1 + st.items.length) % st.items.length } });
          return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          this.select(st.index);
          return true;
        }
        return false;
      },
      hover(i) {
        const st = app.store.get().slash;
        if (st && st.index !== i) app.store.set({ slash: { ...st, index: i } });
      },
    };
  }

  /** Opens the slash menu below a block (used by the "+" handle). */
  slashAfter(pos) {
    const { state, view } = this.editor;
    const node = state.doc.nodeAt(pos);
    if (!node) return;
    let tr = state.tr;
    let at;
    if (node.type.name === 'paragraph' && !node.content.size) {
      at = pos + 1;
    } else {
      const $pos = state.doc.resolve(pos);
      const end = pos + node.nodeSize;
      const para = state.schema.nodes.paragraph.create();
      if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
        const item = node.type.create(node.type.name === 'taskItem' ? { checked: false } : null, para);
        tr = tr.insert(end, item);
        at = end + 2;
      } else if ($pos.parent.canReplaceWith($pos.index() + 1, $pos.index() + 1, para.type)) {
        tr = tr.insert(end, para);
        at = end + 1;
      } else {
        return;
      }
    }
    tr.setSelection(TextSelection.create(tr.doc, at));
    tr.insertText('/', at);
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  /* ---------------- images ---------------- */

  displaySrc(src) {
    return this.host.displaySrc(src);
  }

  isOwnImage(src) {
    return this.host.isOwnImage(src);
  }

  pickImages(range) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    if (range) this.editor.chain().focus().deleteRange(range).run();
    input.onchange = () => {
      const files = [...input.files];
      if (files.length) this.insertImageFiles(files, null);
    };
    input.click();
  }

  async pickFromLibrary(range) {
    if (range) this.editor.chain().focus().deleteRange(range).run();
    const picked = await this.host.pickImage({ multiple: true });
    if (!picked || !picked.length || !this.editor) return;
    insertFigures(this.editor, null, picked.map(p => ({ src: p.src, alt: '', caption: '', width: null, align: 'center', naturalWidth: p.naturalWidth || null, naturalHeight: p.naturalHeight || null })));
  }

  async insertImageFiles(files, pos) {
    if (!this.editor || !files.length) return;
    this.store.set({ busy: files.length > 1 ? `正在处理 ${files.length} 张图片…` : '正在处理图片…' });
    try {
      const results = await this.host.processImages(files, 'body');
      if (!this.editor) return;
      const figures = results.filter(Boolean).map(r => ({ src: r.src, alt: '', caption: '', width: null, align: 'center', naturalWidth: r.naturalWidth || null, naturalHeight: r.naturalHeight || null }));
      if (!figures.length) return;
      if (pos != null) {
        const { state, view } = this.editor;
        const p = Math.max(0, Math.min(pos, state.doc.content.size));
        view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(p))));
      }
      insertFigures(this.editor, null, figures);
    } catch (err) {
      this.host.toast('图片处理失败：' + (err && err.message ? err.message : err), 'error');
    } finally {
      this.store.set({ busy: null });
    }
  }

  async replaceFigureImage(pos) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      this.store.set({ busy: '正在处理图片…' });
      try {
        const [r] = await this.host.processImages([file], 'body');
        const node = this.editor.state.doc.nodeAt(pos);
        if (!r || !node || node.type.name !== 'figure') return;
        this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: r.src, naturalWidth: r.naturalWidth || null, naturalHeight: r.naturalHeight || null }));
      } finally {
        this.store.set({ busy: null });
      }
    };
    input.click();
  }

  async adoptForeignImages(srcs) {
    const unique = [...new Set(srcs)];
    let failed = 0;
    for (const src of unique) {
      const r = await this.host.adoptImage(src).catch(() => null);
      if (!this.editor) return;
      if (!r) { failed++; continue; }
      const { state, view } = this.editor;
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'figure' && node.attrs.src === src) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: r.src, naturalWidth: r.naturalWidth || node.attrs.naturalWidth, naturalHeight: r.naturalHeight || node.attrs.naturalHeight });
        }
      });
      if (tr.docChanged) view.dispatch(tr.setMeta('addToHistory', false));
    }
    if (failed) this.host.toast(`${failed} 张图片无法自动转存，已保留原链接（图片上会标出）`, 'warn');
  }

  refreshImages() {
    if (!this.editor) return;
    const { view } = this.editor;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'figure') {
        const nv = nodeViewFor(view.nodeDOM(pos));
        if (nv) nv.render();
      }
    });
    this.renderZones();
  }

  /* ---------------- paste helpers ---------------- */

  pasteCode(text, mode) {
    const language = resolveLanguage(mode) || 'plaintext';
    const clean = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
    insertBlocks(this.editor, null, [{ type: 'codeBlock', attrs: { language }, content: clean ? [{ type: 'text', text: clean }] : [] }]);
  }

  pasteMarkdown(text) {
    const html = marked.parse(text, { gfm: true, breaks: false, async: false });
    const clean = normalizeHTML(html, { doc: document }).innerHTML;
    this.editor.chain().focus().insertContent(clean, { parseOptions: { preserveWhitespace: false } }).run();
  }

  offerEmbed(url, pos) {
    setTimeout(() => {
      if (!this.editor) return;
      this.store.set({ menu: { type: 'pasteUrl', url, pos } });
    }, 0);
  }

  promptEmbed(range) {
    if (range) this.editor.chain().focus().deleteRange(range).run();
    this.store.set({ embedPrompt: { pos: this.editor.state.selection.from, value: '' } });
  }

  /* ---------------- geometry for the WYSIWYG check ---------------- */

  measure() {
    if (!this.editor) return null;
    const dom = this.editor.view.dom;
    const base = dom.getBoundingClientRect();
    // Published pages leave a blank body out entirely; the editor still shows its placeholder line.
    const blocks = isBlankDoc(this.editor.state.doc) ? [] : [...dom.children].map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, top: Math.round(r.top - base.top), height: Math.round(r.height), left: Math.round(r.left - base.left), width: Math.round(r.width) };
    });
    const wrap = document.querySelector('.page-wrap');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      doc: { top: Math.round(base.top + window.scrollY), left: Math.round(base.left), width: Math.round(base.width), height: Math.round(base.height) },
      pageHeight: wrap ? Math.round(wrap.getBoundingClientRect().height) : 0,
      blocks,
    };
  }

  api() {
    const app = this;
    return {
      load: payload => app.load(payload),
      unload: () => app.unload(),
      setMeta: (meta, cat) => app.setMeta(meta, cat),
      getJSON: () => (app.editor ? app.editor.getJSON() : null),
      flush: () => app.flush(),
      focus: where => (where === 'title' ? app.focusTitle('end') : app.editor && app.editor.commands.focus(where || 'end')),
      scrollTop: () => window.scrollY,
      scrollToHeading: index => app.scrollToHeading(index),
      exec: (cmd, arg) => app.exec(cmd, arg),
      refreshImages: () => app.refreshImages(),
      measure: () => app.measure(),
      setReadOnly: ro => {
        if (app.editor) app.editor.setEditable(!ro);
        app.store.set({ readOnly: ro });
      },
      fontsReady: () => document.fonts.ready.then(() => true),
    };
  }

  scrollToHeading(index) {
    if (!this.editor) return;
    const { view } = this.editor;
    let i = 0;
    let target = null;
    view.state.doc.descendants((node, pos) => {
      if (target != null) return false;
      if (node.type.name === 'heading') {
        if (i === index) target = pos;
        i++;
      }
      return true;
    });
    if (target == null) return;
    const dom = view.nodeDOM(target);
    if (dom && dom.getBoundingClientRect) {
      const y = dom.getBoundingClientRect().top + window.scrollY - 100;
      window.scrollTo({ top: y, behavior: 'smooth' });
      const end = target + view.state.doc.nodeAt(target).nodeSize - 1;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
      view.dom.focus({ preventScroll: true });
    }
  }

  exec(cmd, arg) {
    const ed = this.editor;
    if (!ed) return;
    if (cmd === 'undo') ed.chain().focus().undo().run();
    else if (cmd === 'redo') ed.chain().focus().redo().run();
    else if (cmd === 'find') this.openFind(!!arg);
    else if (cmd === 'insertImage') this.pickImages(null);
    else if (cmd === 'selectAll') ed.chain().focus().selectAll().run();
    else if (cmd === 'openField') {
      const target = document.querySelector(arg === 'focus' ? '[data-field="cover"], [data-field="image"]' : `[data-field="${arg}"]`);
      if (target) target.scrollIntoView({ block: 'center' });
      this.openField(arg, target || null);
    }
  }
}

function placeCaretAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = document.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function caretAtEnd(el) {
  const sel = document.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(el);
  r.setStart(sel.focusNode, sel.focusOffset);
  return !r.toString().length;
}

/** Removes and returns the title text after a collapsed caret, the part Enter moves into the body. */
function takeTextAfterCaret(el) {
  const sel = document.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed || !el.contains(sel.focusNode)) return '';
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setStart(sel.focusNode, sel.focusOffset);
  const text = r.toString();
  if (!text.trim()) return '';
  r.deleteContents();
  return text.trim();
}

function hasFiles(e) {
  return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
}

function firstLineRect(view, target) {
  let pos = target.pos + 1;
  if (!target.node.isTextblock) {
    let found = null;
    target.node.descendants((child, p) => {
      if (found == null && child.isTextblock) found = target.pos + 1 + p + 1;
      return found == null;
    });
    if (found == null) return null;
    pos = found;
  }
  try {
    const c = view.coordsAtPos(pos, 1);
    return { top: c.top, height: Math.max(16, c.bottom - c.top) };
  } catch {
    return null;
  }
}

