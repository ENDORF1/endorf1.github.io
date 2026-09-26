import { TextSelection, NodeSelection, Selection } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';

const LIST_TYPES = ['bulletList', 'orderedList', 'taskList'];

/** Turns the block at the cursor (or at `pos`) into another block type, Feishu-style. */
export function turnInto(editor, type, range = null, pos = null) {
  let chain = editor.chain().focus();
  if (range) chain = chain.deleteRange(range);
  if (pos != null) chain = chain.command(({ tr }) => cursorIntoBlock(tr, pos));
  const active = t => editor.isActive(t);
  switch (type) {
    case 'paragraph':
      chain = chain.command(({ state, commands }) => {
        const $from = state.selection.$from;
        if ($from.parent.type.name !== 'paragraph') return commands.setParagraph();
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d).type.name;
          if (n === 'listItem' || n === 'taskItem') return commands.liftListItem(n);
          if (n === 'blockquote') return commands.lift('blockquote');
        }
        return true;
      });
      break;
    case 'h1': case 'h2': case 'h3': case 'h4':
      chain = chain.setNode('heading', { level: Number(type[1]) });
      break;
    case 'bulletList':
      if (!active('bulletList')) chain = chain.toggleBulletList();
      break;
    case 'orderedList':
      if (!active('orderedList')) chain = chain.toggleOrderedList();
      break;
    case 'taskList':
      if (!active('taskList')) chain = chain.toggleTaskList();
      break;
    case 'blockquote':
      if (!active('blockquote')) chain = chain.setParagraph().wrapIn('blockquote');
      break;
    case 'callout':
      if (!active('callout')) chain = chain.wrapIn('callout');
      break;
    case 'codeBlock':
      if (!active('codeBlock')) chain = chain.setNode('codeBlock', { language: 'plaintext' });
      break;
    default:
      break;
  }
  return chain.run();
}

function cursorIntoBlock(tr, pos) {
  const node = tr.doc.nodeAt(pos);
  if (!node) return false;
  let target = pos + node.nodeSize - 1;
  if (!node.isTextblock) {
    let found = null;
    node.descendants((child, childPos) => {
      if (found == null && child.isTextblock) found = pos + 1 + childPos + child.nodeSize - 1;
      return found == null;
    });
    if (found == null) return false;
    target = found;
  }
  tr.setSelection(TextSelection.create(tr.doc, target));
  return true;
}

function placeCursorAfterInsert(tr, from, to) {
  let target = null;
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (target != null) return false;
    if (node.isTextblock) { target = pos + 1; return false; }
    return true;
  });
  if (target != null) {
    tr.setSelection(TextSelection.create(tr.doc, target));
    return;
  }
  const first = tr.doc.nodeAt(from);
  if (first && to - from === first.nodeSize && (first.type.name === 'figure' || first.type.name === 'embed')) {
    tr.setSelection(NodeSelection.create(tr.doc, from));
    return;
  }
  const after = tr.doc.resolve(to).nodeAfter;
  if (after && after.isTextblock) {
    tr.setSelection(TextSelection.create(tr.doc, to + 1));
    return;
  }
  if (after) {
    const next = Selection.findFrom(tr.doc.resolve(to), 1, true);
    if (next) {
      tr.setSelection(next);
      return;
    }
  }
  const $to = tr.doc.resolve(to);
  if ($to.parent.canReplaceWith($to.index(), $to.index(), tr.doc.type.schema.nodes.paragraph)) {
    tr.insert(to, tr.doc.type.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, to + 1));
  }
}

/**
 * Inserts blocks from the slash menu: an empty paragraph is replaced, otherwise the
 * blocks go right after the current block.
 */
export function insertBlocks(editor, range, jsonNodes) {
  return editor.chain().focus().deleteRange(range || { from: editor.state.selection.from, to: editor.state.selection.from })
    .command(({ tr, state }) => {
      const nodes = jsonNodes.map(j => state.schema.nodeFromJSON(j));
      const $from = tr.selection.$from;
      const depth = $from.depth;
      const block = $from.parent;
      const frag = Fragment.from(nodes);
      if (depth > 0 && block.isTextblock && block.content.size === 0) {
        const parent = $from.node(depth - 1);
        const index = $from.index(depth - 1);
        const soleChild = parent.childCount === 1 && depth > 1;
        if (!soleChild && parent.canReplace(index, index + 1, frag)) {
          const start = $from.before(depth);
          tr.replaceWith(start, $from.after(depth), frag);
          placeCursorAfterInsert(tr, start, start + frag.size);
          tr.scrollIntoView();
          return true;
        }
      }
      if (depth === 0) {
        const at = $from.pos;
        tr.insert(at, frag);
        placeCursorAfterInsert(tr, at, at + frag.size);
        tr.scrollIntoView();
        return true;
      }
      for (let d = depth; d >= 1; d--) {
        const parent = $from.node(d - 1);
        const idx = $from.indexAfter(d - 1);
        if (parent.canReplace(idx, idx, frag)) {
          const at = $from.after(d);
          tr.insert(at, frag);
          placeCursorAfterInsert(tr, at, at + frag.size);
          tr.scrollIntoView();
          return true;
        }
      }
      return false;
    })
    .run();
}

export function insertFigures(editor, range, figures) {
  if (!figures.length) return false;
  return insertBlocks(editor, range, figures.map(attrs => ({ type: 'figure', attrs })));
}

/** Resolves the draggable block around a document position: list items, else top-level blocks. */
export function blockAt(state, pos) {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (n.type.name === 'listItem' || n.type.name === 'taskItem') return { pos: $pos.before(d), node: n, depth: d };
  }
  if ($pos.depth >= 1) return { pos: $pos.before(1), node: $pos.node(1), depth: 1 };
  const after = $pos.nodeAfter;
  if (after) return { pos: $pos.pos, node: after, depth: 1 };
  return null;
}

export function selectBlock(editor, pos) {
  const { state, view } = editor;
  if (pos < 0 || pos >= state.doc.content.size) return;
  view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  view.focus();
}

export function deleteBlock(editor, pos) {
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const tr = state.tr;
  if (state.doc.childCount === 1 && pos === 0) {
    tr.replaceWith(0, node.nodeSize, state.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, 1));
  } else {
    tr.delete(pos, pos + node.nodeSize);
    const $p = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
    tr.setSelection(Selection.near($p, -1));
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

export function duplicateBlock(editor, pos) {
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const at = pos + node.nodeSize;
  const tr = state.tr.insert(at, node.copy(node.content));
  tr.setSelection(NodeSelection.create(tr.doc, at));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Swaps the block with its previous/next sibling inside the same parent. */
export function moveBlock(editor, pos, dir) {
  const { state, view } = editor;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  const node = parent.child(index);
  const otherIndex = index + dir;
  if (otherIndex < 0 || otherIndex >= parent.childCount) return false;
  const other = parent.child(otherIndex);
  const tr = state.tr;
  const sel = state.selection;
  const offsetInNode = sel.from - pos;
  if (dir < 0) {
    const otherPos = pos - other.nodeSize;
    tr.replaceWith(otherPos, pos + node.nodeSize, [node, other]);
    restoreSelection(tr, sel, otherPos, offsetInNode, node);
  } else {
    const otherEnd = pos + node.nodeSize + other.nodeSize;
    tr.replaceWith(pos, otherEnd, [other, node]);
    restoreSelection(tr, sel, pos + other.nodeSize, offsetInNode, node);
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

function restoreSelection(tr, sel, newPos, offset, node) {
  if (sel instanceof NodeSelection) {
    tr.setSelection(NodeSelection.create(tr.doc, newPos));
  } else if (offset >= 0 && offset <= node.nodeSize) {
    const p = Math.min(newPos + offset, tr.doc.content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(p)));
  }
}

export function currentBlockPos(state) {
  const sel = state.selection;
  if (sel instanceof NodeSelection) return sel.from;
  const b = blockAt(state, sel.from);
  return b ? b.pos : null;
}

export function setBlockAttrs(editor, pos, attrs) {
  const { state, view } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const tr = state.tr;
  const apply = (n, p) => {
    const allowed = {};
    for (const k of Object.keys(attrs)) if (k in n.attrs) allowed[k] = attrs[k];
    if (Object.keys(allowed).length) tr.setNodeMarkup(p, undefined, { ...n.attrs, ...allowed });
  };
  if (node.isTextblock) apply(node, pos);
  else node.descendants((child, childPos) => {
    if (child.isTextblock) apply(child, pos + 1 + childPos);
    return !child.isTextblock;
  });
  view.dispatch(tr);
  view.focus();
}

export function textblockAttr(node, key) {
  if (node.isTextblock) return node.attrs[key];
  let v;
  node.descendants(child => {
    if (v === undefined && child.isTextblock) v = child.attrs[key];
    return v === undefined;
  });
  return v;
}

export function changeIndent(editor, delta) {
  const { state, view } = editor;
  const { from, to } = state.selection;
  const tr = state.tr;
  let changed = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      const $p = state.doc.resolve(pos);
      if ($p.parent.type.name === 'listItem' || $p.parent.type.name === 'taskItem' || $p.parent.type.name === 'tableCell' || $p.parent.type.name === 'tableHeader') return false;
      const next = Math.max(0, Math.min(6, (node.attrs.indent || 0) + delta));
      if (next !== (node.attrs.indent || 0)) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
        changed = true;
      }
      return false;
    }
    return true;
  });
  if (changed) view.dispatch(tr);
  return changed;
}
