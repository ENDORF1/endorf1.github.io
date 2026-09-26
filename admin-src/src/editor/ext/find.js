import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const findKey = new PluginKey('find');

const EMPTY = { query: '', caseSensitive: false, matches: [], current: -1, deco: DecorationSet.empty };

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatches(doc, query, caseSensitive) {
  const out = [];
  if (!query) return out;
  const re = new RegExp(escapeRe(query), caseSensitive ? 'g' : 'gi');
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, '\ufffc');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
      if (out.length > 5000) return false;
    }
    return false;
  });
  return out;
}

function decorate(doc, matches, current) {
  if (!matches.length) return DecorationSet.empty;
  return DecorationSet.create(doc, matches.map((m, i) => Decoration.inline(m.from, m.to, {
    class: i === current ? 'find-match is-current' : 'find-match',
  })));
}

function build(doc, query, caseSensitive, current, anchor) {
  const matches = findMatches(doc, query, caseSensitive);
  let cur = current;
  if (anchor != null) {
    cur = matches.findIndex(m => m.from >= anchor);
    if (cur < 0) cur = matches.length ? 0 : -1;
  }
  if (cur >= matches.length) cur = matches.length - 1;
  if (matches.length && cur < 0) cur = 0;
  return { query, caseSensitive, matches, current: cur, deco: decorate(doc, matches, cur) };
}

export const FindReplace = Extension.create({
  name: 'findReplace',

  addStorage() {
    return { listeners: new Set() };
  },

  addCommands() {
    return {
      setFind: ({ query, caseSensitive, anchor }) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(findKey, { type: 'set', query, caseSensitive, anchor });
        return true;
      },
      findStep: dir => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(findKey, { type: 'step', dir });
        return true;
      },
      clearFind: () => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(findKey, { type: 'clear' });
        return true;
      },
      replaceCurrent: text => ({ state, tr, dispatch }) => {
        const st = findKey.getState(state);
        if (!st || st.current < 0) return false;
        const m = st.matches[st.current];
        if (dispatch) {
          if (text) tr.insertText(text, m.from, m.to);
          else tr.delete(m.from, m.to);
          tr.setMeta(findKey, { type: 'refresh', anchor: m.from + text.length });
        }
        return true;
      },
      replaceAll: text => ({ state, tr, dispatch }) => {
        const st = findKey.getState(state);
        if (!st || !st.matches.length) return false;
        if (dispatch) {
          for (let i = st.matches.length - 1; i >= 0; i--) {
            const m = st.matches[i];
            if (text) tr.insertText(text, m.from, m.to);
            else tr.delete(m.from, m.to);
          }
          tr.setMeta(findKey, { type: 'refresh', anchor: 0 });
        }
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: findKey,
      state: {
        init: () => EMPTY,
        apply(tr, prev, _old, newState) {
          const meta = tr.getMeta(findKey);
          if (meta) {
            if (meta.type === 'clear') return EMPTY;
            if (meta.type === 'set') return build(newState.doc, meta.query, !!meta.caseSensitive, prev.current, meta.anchor ?? null);
            if (meta.type === 'step') {
              if (!prev.matches.length) return prev;
              const cur = (prev.current + meta.dir + prev.matches.length) % prev.matches.length;
              return { ...prev, current: cur, deco: decorate(newState.doc, prev.matches, cur) };
            }
            if (meta.type === 'refresh') return build(newState.doc, prev.query, prev.caseSensitive, prev.current, meta.anchor);
          }
          if (tr.docChanged && prev.query) return build(newState.doc, prev.query, prev.caseSensitive, prev.current, null);
          return prev;
        },
      },
      props: {
        decorations: state => findKey.getState(state).deco,
      },
    })];
  },
});
