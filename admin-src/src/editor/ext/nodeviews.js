import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Figure, Embed, figureDOMSpec, embedDOMSpec } from '../../shared/extensions.js';

const views = new WeakMap();

export function nodeViewFor(dom) {
  return dom ? views.get(dom) || null : null;
}

function syncAttrs(el, attrs, keep = []) {
  for (const a of [...el.attributes]) {
    if (a.name in attrs || keep.includes(a.name)) continue;
    el.removeAttribute(a.name);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) el.removeAttribute(k);
    else if (el.getAttribute(k) !== String(v)) el.setAttribute(k, String(v));
  }
}

class FigureView {
  constructor(node, getPos, editor, app) {
    this.node = node;
    this.getPos = getPos;
    this.editor = editor;
    this.app = app;
    this.editingCaption = false;
    this.dom = document.createElement('figure');
    this.img = document.createElement('img');
    this.img.draggable = false;
    this.dom.appendChild(this.img);
    this.cap = null;
    this.img.addEventListener('error', () => {
      if (!this.img.getAttribute('src')) return;
      this.dom.classList.add('is-broken');
      app.bump();
    });
    this.img.addEventListener('load', () => {
      this.dom.classList.remove('is-broken');
      app.bump();
    });
    views.set(this.dom, this);
    this.render();
  }

  render() {
    const spec = figureDOMSpec(this.node.attrs);
    const figAttrs = { ...spec[1] };
    const selected = this.dom.classList.contains('ProseMirror-selectednode');
    const broken = this.dom.classList.contains('is-broken');
    figAttrs.class = [figAttrs.class, selected && 'ProseMirror-selectednode', broken && 'is-broken'].filter(Boolean).join(' ');
    syncAttrs(this.dom, figAttrs, ['contenteditable', 'draggable']);
    const imgAttrs = { ...spec[2][1], src: this.app.displaySrc(this.node.attrs.src), draggable: 'false' };
    if (imgAttrs.src !== this.img.getAttribute('src')) this.dom.classList.remove('is-broken');
    syncAttrs(this.img, imgAttrs);
    if (this.editingCaption) return;
    const caption = this.node.attrs.caption || '';
    if (caption) {
      if (!this.cap) {
        this.cap = document.createElement('figcaption');
        this.dom.appendChild(this.cap);
      }
      if (this.cap.textContent !== caption) this.cap.textContent = caption;
    } else if (this.cap) {
      this.cap.remove();
      this.cap = null;
    }
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  /** Live width preview while dragging a resize handle; committed separately. */
  previewWidth(pct) {
    if (pct) {
      this.dom.setAttribute('data-sized', '');
      this.dom.style.width = pct + '%';
    } else {
      this.render();
    }
  }

  startCaptionEdit(point) {
    if (this.editingCaption) return;
    this.editingCaption = true;
    if (!this.cap) {
      this.cap = document.createElement('figcaption');
      this.dom.appendChild(this.cap);
    }
    const cap = this.cap;
    cap.setAttribute('contenteditable', 'plaintext-only');
    if (cap.contentEditable !== 'plaintext-only') cap.setAttribute('contenteditable', 'true');
    cap.spellcheck = false;
    const onKey = e => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.finishCaptionEdit('after');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.finishCaptionEdit('select');
      }
    };
    const onPaste = e => {
      e.preventDefault();
      const text = (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, text);
    };
    const onBlur = () => this.finishCaptionEdit(null);
    cap.addEventListener('keydown', onKey);
    cap.addEventListener('paste', onPaste);
    cap.addEventListener('blur', onBlur);
    this.captionCleanup = () => {
      cap.removeEventListener('keydown', onKey);
      cap.removeEventListener('paste', onPaste);
      cap.removeEventListener('blur', onBlur);
      cap.removeAttribute('contenteditable');
    };
    cap.focus();
    const sel = document.getSelection();
    let range = null;
    if (point && document.caretRangeFromPoint) range = document.caretRangeFromPoint(point.x, point.y);
    if (!range || !cap.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(cap);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
    this.app.bump();
  }

  finishCaptionEdit(then) {
    if (!this.editingCaption) return;
    const text = (this.cap ? this.cap.textContent : '').replace(/\s+/g, ' ').trim();
    this.editingCaption = false;
    if (this.captionCleanup) this.captionCleanup();
    this.captionCleanup = null;
    const pos = this.getPos();
    const { view } = this.editor;
    if (typeof pos !== 'number') return;
    const tr = view.state.tr;
    if (text !== (this.node.attrs.caption || '')) tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, caption: text });
    else this.render();
    if (then === 'after') {
      const after = pos + this.node.nodeSize;
      const $after = tr.doc.resolve(after);
      if ($after.nodeAfter && $after.nodeAfter.isTextblock) {
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
      } else {
        tr.insert(after, view.state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
      }
      view.dispatch(tr.scrollIntoView());
      view.focus();
    } else if (then === 'select') {
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      view.dispatch(tr);
      view.focus();
    } else if (tr.docChanged) {
      view.dispatch(tr);
    }
    this.app.bump();
  }

  stopEvent(e) {
    if (this.cap && this.cap.contains(e.target)) {
      if (this.editingCaption) return true;
      if (e.type === 'mousedown' && e.button === 0) {
        e.preventDefault();
        const point = { x: e.clientX, y: e.clientY };
        setTimeout(() => this.startCaptionEdit(point), 0);
        return true;
      }
    }
    return false;
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    if (this.captionCleanup) this.captionCleanup();
    views.delete(this.dom);
  }
}

export function EditableFigure(app) {
  return Figure.extend({
    addNodeView() {
      return ({ node, getPos, editor }) => new FigureView(node, getPos, editor, app);
    },
  });
}

class EmbedView {
  constructor(node, getPos, editor, app) {
    this.node = node;
    this.getPos = getPos;
    this.app = app;
    this.dom = document.createElement('div');
    this.iframe = document.createElement('iframe');
    this.shield = document.createElement('div');
    this.shield.className = 'embed-shield';
    this.dom.appendChild(this.iframe);
    this.dom.appendChild(this.shield);
    views.set(this.dom, this);
    this.render();
  }

  render() {
    const spec = embedDOMSpec(this.node.attrs);
    const attrs = { ...spec[1] };
    const cls = [attrs.class];
    if (this.dom.classList.contains('ProseMirror-selectednode')) cls.push('ProseMirror-selectednode');
    if (this.dom.classList.contains('is-live')) cls.push('is-live');
    attrs.class = cls.join(' ');
    syncAttrs(this.dom, attrs, ['contenteditable', 'draggable']);
    syncAttrs(this.iframe, spec[2][1]);
  }

  setLive(on) {
    this.dom.classList.toggle('is-live', on);
    this.app.bump();
  }

  get live() {
    return this.dom.classList.contains('is-live');
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode() {
    this.dom.classList.remove('ProseMirror-selectednode');
    this.dom.classList.remove('is-live');
  }

  stopEvent() {
    return false;
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    views.delete(this.dom);
  }
}

export function EditableEmbed(app) {
  return Embed.extend({
    addNodeView() {
      return ({ node, getPos, editor }) => new EmbedView(node, getPos, editor, app);
    },
  });
}
