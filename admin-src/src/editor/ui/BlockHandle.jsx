import { useRef } from 'preact/hooks';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Icon } from '../../shared/icons.jsx';
import { headingSlug } from '../../shared/render.js';
import { Floating, MenuItem, useDismiss, MOD } from './Floating.jsx';
import { BLOCK_TYPES, TEXT_COLORS, blockTypeOfNode } from './palette.js';
import { deleteBlock, duplicateBlock, moveBlock, selectBlock, setBlockAttrs, textblockAttr, turnInto } from '../commands.js';

const HANDLE_W = 46;

export function BlockHandle({ app, hover, menuOpen }) {
  const ref = useRef(null);
  if (!hover) return null;
  const narrow = window.innerWidth < 640;
  const baseLeft = hover.isList ? hover.itemLeft - 26 : hover.left;
  const left = Math.max(window.scrollX + 2, baseLeft - (narrow ? 24 : HANDLE_W) - 4);
  const top = hover.top + hover.height / 2 - 12;

  const onDragStart = e => {
    const ed = app.editor;
    if (!ed) return;
    const { state, view } = ed;
    const node = state.doc.nodeAt(hover.pos);
    if (!node) return;
    const sel = NodeSelection.create(state.doc, hover.pos);
    view.dispatch(state.tr.setSelection(sel));
    const slice = sel.content();
    const { dom, text } = view.serializeForClipboard(slice);
    e.dataTransfer.clearData();
    e.dataTransfer.setData('text/html', dom.innerHTML);
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.effectAllowed = 'copyMove';
    const blockDom = view.nodeDOM(hover.pos);
    if (blockDom && blockDom.nodeType === 1) e.dataTransfer.setDragImage(blockDom, 0, 0);
    view.dragging = { slice, move: true, node: sel };
    app.store.set({ dragging: true, hover: null });
  };

  const onGripClick = () => {
    const ed = app.editor;
    if (!ed) return;
    selectBlock(ed, hover.pos);
    app.openMenu({ type: 'block', pos: hover.pos, anchor: { x: left + (narrow ? 0 : 24), y: top, w: 22, h: 24 } });
  };

  return (
    <div ref={ref} class={`ui-handle ${menuOpen ? '' : ''}`} style={{ left: left + 'px', top: top + 'px' }}
      onMouseDown={e => { if (!e.target.closest('.ui-grip')) e.preventDefault(); }}>
      {!narrow && (
        <button type="button" title="在下方插入" onClick={() => app.slashAfter(hover.pos)}>
          <Icon name="plus" size={16} />
        </button>
      )}
      <button type="button" class="ui-grip" title="拖动移动 · 点击打开菜单" draggable onDragStart={onDragStart}
        onDragEnd={() => app.store.set({ dragging: false })} onClick={onGripClick}>
        <Icon name="grip" size={16} stroke={2.6} />
      </button>
    </div>
  );
}

export function docAnchor(anchor) {
  return () => new DOMRect(anchor.x - window.scrollX, anchor.y - window.scrollY, anchor.w, anchor.h);
}

export function BlockMenu({ app, menu }) {
  const ref = useRef(null);
  const ed = app.editor;
  useDismiss(ref, () => app.closeMenu());
  if (!ed) return null;
  const node = ed.state.doc.nodeAt(menu.pos);
  if (!node) return null;
  const type = node.type.name;
  const current = blockTypeOfNode(node);
  const convertible = ['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'codeBlock', 'callout', 'bulletList', 'orderedList', 'taskList'].includes(type);
  const alignable = type === 'paragraph' || type === 'heading';
  const align = textblockAttr(node, 'textAlign') || 'left';
  const close = () => app.closeMenu();
  const run = fn => () => { fn(); close(); };

  const doTurn = id => {
    turnInto(ed, id, null, menu.pos);
    close();
  };

  const copyHeadingLink = () => {
    let count = new Map();
    let id = null;
    ed.state.doc.descendants((n, p) => {
      if (n.type.name !== 'heading') return true;
      const base = headingSlug(n.textContent);
      const k = (count.get(base) || 0) + 1;
      count.set(base, k);
      if (p === menu.pos) id = k === 1 ? base : `${base}-${k}`;
      return false;
    });
    const url = app.host.pageUrl(app.doc.docId);
    if (!url) {
      app.host.toast('这篇文档还没有发布，发布后链接才能访问', 'info');
    }
    navigator.clipboard.writeText(`${url || ''}#${id}`).then(() => app.host.toast('已复制标题链接', 'success'));
    close();
  };

  const colorBlock = value => {
    const chain = ed.chain().focus().command(({ tr }) => {
      tr.setSelection(TextSelection.between(tr.doc.resolve(menu.pos + 1), tr.doc.resolve(menu.pos + node.nodeSize - 1)));
      return true;
    });
    (value ? chain.setColor(value) : chain.unsetColor()).run();
    close();
  };

  return (
    <Floating getRect={docAnchor(menu.anchor)} placement="right-start" offset={6} fallback={['left-start', 'bottom-start']} className="ui-panel" keepFocus>
      <div ref={ref} class="ui-menu" style={{ width: '248px' }}>
        {convertible && (
          <>
            <div class="ui-menu-group">转换为</div>
            <div class="ui-toolbar" style={{ flexWrap: 'wrap', padding: '0 4px 4px' }}>
              {BLOCK_TYPES.map(b => (
                <button type="button" class={`ui-btn ${current === b.id ? 'is-active' : ''}`} title={b.title} onClick={() => doTurn(b.id)}>
                  <Icon name={b.icon} />
                </button>
              ))}
            </div>
          </>
        )}
        {alignable && (
          <>
            <div class="ui-menu-group">对齐与缩进</div>
            <div class="ui-toolbar" style={{ padding: '0 4px 4px' }}>
              {[['left', 'alignLeft', '左对齐'], ['center', 'alignCenter', '居中'], ['right', 'alignRight', '右对齐'], ['justify', 'alignJustify', '两端对齐']].map(([v, ic, t]) => (
                <button type="button" class={`ui-btn ${align === v ? 'is-active' : ''}`} title={t} onClick={run(() => setBlockAttrs(ed, menu.pos, { textAlign: v === 'left' ? null : v }))}>
                  <Icon name={ic} />
                </button>
              ))}
              <span class="ui-sep" />
              <button type="button" class="ui-btn" title="减少缩进  Shift+Tab" onClick={run(() => setBlockAttrs(ed, menu.pos, { indent: Math.max(0, (node.attrs.indent || 0) - 1) }))}><Icon name="outdent" /></button>
              <button type="button" class="ui-btn" title="增加缩进  Tab" onClick={run(() => setBlockAttrs(ed, menu.pos, { indent: Math.min(6, (node.attrs.indent || 0) + 1) }))}><Icon name="indent" /></button>
            </div>
          </>
        )}
        {(node.isTextblock || convertible) && type !== 'codeBlock' && (
          <>
            <div class="ui-menu-group">文字颜色</div>
            <div class="ui-colors" style={{ padding: '0 8px 6px', gridTemplateColumns: 'repeat(10,18px)', gap: '4px' }}>
              {TEXT_COLORS.map(c => (
                <button type="button" class="ui-swatch" title={c.label} style={{ width: '18px', height: '18px', color: c.value || '#c8e0f0', fontSize: '11px' }} onClick={() => colorBlock(c.value)}>A</button>
              ))}
            </div>
          </>
        )}
        <div class="ui-menu-sep" />
        {type === 'heading' && <MenuItem compact icon={<Icon name="link" />} title="复制标题链接" onClick={copyHeadingLink} />}
        <MenuItem compact icon={<Icon name="duplicate" />} title="创建副本" kbd={`${MOD}+D`} onClick={run(() => duplicateBlock(ed, menu.pos))} />
        <MenuItem compact icon={<Icon name="arrowUp" />} title="上移" kbd="Alt+Shift+↑" onClick={run(() => { selectBlock(ed, menu.pos); moveBlock(ed, menu.pos, -1); })} />
        <MenuItem compact icon={<Icon name="arrowDown" />} title="下移" kbd="Alt+Shift+↓" onClick={run(() => { selectBlock(ed, menu.pos); moveBlock(ed, menu.pos, 1); })} />
        <MenuItem compact danger icon={<Icon name="trash" />} title="删除" kbd="Del" onClick={run(() => deleteBlock(ed, menu.pos))} />
      </div>
    </Floating>
  );
}
