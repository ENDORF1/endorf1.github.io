import { Extension, wrappingInputRule, textblockTypeInputRule } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { changeIndent, currentBlockPos, duplicateBlock, moveBlock, turnInto } from '../commands.js';

export function EditorKeys(app) {
  return Extension.create({
    name: 'editorKeys',
    priority: 50,

    addKeyboardShortcuts() {
      const ed = () => this.editor;
      return {
        Tab: () => changeIndent(ed(), 1) || true,
        'Shift-Tab': () => changeIndent(ed(), -1) || true,
        'Mod-k': () => { app.openLinkEditor(); return true; },
        'Mod-f': () => { app.openFind(false); return true; },
        'Mod-h': () => { app.openFind(true); return true; },
        'Mod-s': () => { app.host.shortcut('save'); return true; },
        'Mod-d': () => {
          const pos = currentBlockPos(ed().state);
          if (pos != null) duplicateBlock(ed(), pos);
          return true;
        },
        'Alt-Shift-ArrowUp': () => {
          const pos = currentBlockPos(ed().state);
          return pos != null && moveBlock(ed(), pos, -1);
        },
        'Alt-Shift-ArrowDown': () => {
          const pos = currentBlockPos(ed().state);
          return pos != null && moveBlock(ed(), pos, 1);
        },
        'Mod-Alt-0': () => turnInto(ed(), 'paragraph'),
        'Mod-Shift-c': () => turnInto(ed(), 'callout'),
        Escape: () => {
          if (app.closeTransient()) return true;
          const { state, view } = ed();
          if (state.selection instanceof NodeSelection) return false;
          const pos = currentBlockPos(state);
          if (pos == null) return false;
          view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
          return true;
        },
        ArrowUp: () => {
          const { state, view } = ed();
          const sel = state.selection;
          if (!(sel instanceof TextSelection) || !sel.empty) return false;
          const first = state.doc.firstChild;
          if (!first || !first.isTextblock || sel.from > first.nodeSize) return false;
          if (!view.endOfTextblock('up')) return false;
          return app.focusTitle('end');
        },
        Backspace: () => {
          const { state } = ed();
          const sel = state.selection;
          if (!sel.empty || sel.from !== 1) return false;
          const first = state.doc.firstChild;
          if (state.doc.childCount !== 1 || !first || first.type.name !== 'paragraph' || first.content.size) return false;
          return app.focusTitle('end');
        },
      };
    },

    addInputRules() {
      const { schema } = this.editor;
      const rules = [];
      if (schema.nodes.taskList) rules.push(wrappingInputRule({ find: /^\s*【\s*】\s$/, type: schema.nodes.taskItem }));
      if (schema.nodes.blockquote) rules.push(wrappingInputRule({ find: /^\s*》\s$/, type: schema.nodes.blockquote }));
      if (schema.nodes.codeBlock) rules.push(textblockTypeInputRule({ find: /^···([a-z+#-]*)?[\s\n]$/, type: schema.nodes.codeBlock, getAttributes: m => ({ language: m[1] || 'plaintext' }) }));
      if (schema.nodes.bulletList) rules.push(wrappingInputRule({ find: /^\s*·\s$/, type: schema.nodes.bulletList }));
      return rules;
    },
  });
}
