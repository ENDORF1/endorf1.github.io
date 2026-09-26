import { useEffect, useRef, useState } from 'preact/hooks';
import { posToDOMRect, getMarkRange } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { Icon } from '../../shared/icons.jsx';
import { LANGUAGES, languageLabel } from '../../shared/lowlight.js';
import { CELL_COLORS, embedFromUrl, CALLOUT_COLORS } from '../../shared/extensions.js';
import { Floating, Btn, MenuItem, useDismiss, elRect, MOD } from './Floating.jsx';
import { TEXT_COLORS, BG_COLORS, BLOCK_TYPES, CALLOUT_EMOJIS, CALLOUT_COLOR_SWATCH, currentBlockType } from './palette.js';
import { nodeViewFor } from '../ext/nodeviews.js';
import { insertBlocks, turnInto, deleteBlock } from '../commands.js';

const keepSel = e => {
  if (!e.target.closest('input,textarea,select')) e.preventDefault();
};

function selectionRect(ed) {
  return () => {
    const { from, to } = ed.state.selection;
    try { return posToDOMRect(ed.view, from, to); } catch { return null; }
  };
}

export function normalizeHref(v) {
  const s = (v || '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s)) return 'https://' + s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return /^(javascript|data|vbscript):/i.test(s) ? '' : s;
  return 'https://' + s;
}

/* ---------------- bubble (text selection) ---------------- */

export function BubbleMenu({ app }) {
  const ed = app.editor;
  const [open, setOpen] = useState(null);
  const panel = open && open.id;
  const toggle = (id, e) => {
    const btn = e && e.currentTarget;
    setOpen(panel === id ? null : { id, left: btn ? btn.offsetLeft : 0 });
  };
  const setPanel = () => setOpen(null);
  const dropStyle = extra => ({ position: 'absolute', left: (open ? open.left : 0) + 'px', top: 'calc(100% + 6px)', ...extra });
  const type = currentBlockType(ed);
  const typeInfo = BLOCK_TYPES.find(b => b.id === type) || BLOCK_TYPES[0];
  const color = ed.getAttributes('textStyle').color || null;
  const bg = ed.getAttributes('textStyle').backgroundColor || null;
  const align = ed.getAttributes('paragraph').textAlign || ed.getAttributes('heading').textAlign || 'left';
  const c = () => ed.chain().focus();

  return (
    <Floating getRect={selectionRect(ed)} placement="top" offset={10} fallback={['bottom']} className="ui-panel" keepFocus>
      <div class="ui-toolbar" style={{ position: 'relative' }} onMouseDown={keepSel}>
        <Btn title="转换块类型" onClick={e => toggle('turn', e)} icon={<Icon name={typeInfo.icon} />}>
          <Icon name="down" size={12} className="ui-caret" />
        </Btn>
        <span class="ui-sep" />
        <Btn title="加粗" kbd={`${MOD}+B`} active={ed.isActive('bold')} onClick={() => c().toggleBold().run()} icon={<Icon name="bold" />} />
        <Btn title="斜体" kbd={`${MOD}+I`} active={ed.isActive('italic')} onClick={() => c().toggleItalic().run()} icon={<Icon name="italic" />} />
        <Btn title="下划线" kbd={`${MOD}+U`} active={ed.isActive('underline')} onClick={() => c().toggleUnderline().run()} icon={<Icon name="underline" />} />
        <Btn title="删除线" kbd={`${MOD}+Shift+S`} active={ed.isActive('strike')} onClick={() => c().toggleStrike().run()} icon={<Icon name="strike" />} />
        <Btn title="行内代码" kbd={`${MOD}+E`} active={ed.isActive('code')} onClick={() => c().toggleCode().run()} icon={<Icon name="code" />} />
        <span class="ui-sep" />
        <Btn title="链接" kbd={`${MOD}+K`} active={ed.isActive('link')} onClick={() => app.openLinkEditor()} icon={<Icon name="link" />} />
        <Btn title="文字颜色与背景" active={!!(color || bg)} onClick={e => toggle('color', e)}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: color || '#d8e8f5', background: bg || 'transparent', padding: '0 3px', borderRadius: '3px', lineHeight: '18px' }}>A</span>
          <Icon name="down" size={12} className="ui-caret" />
        </Btn>
        <Btn title="对齐" onClick={e => toggle('align', e)} icon={<Icon name={{ left: 'alignLeft', center: 'alignCenter', right: 'alignRight', justify: 'alignJustify' }[align] || 'alignLeft'} />}>
          <Icon name="down" size={12} className="ui-caret" />
        </Btn>
        <Btn title="更多" onClick={e => toggle('more', e)} icon={<Icon name="more" />} />

        {panel === 'turn' && (
          <div class="ui-panel ui-menu" style={dropStyle({ width: '200px' })}>
            {BLOCK_TYPES.map(b => (
              <MenuItem compact icon={<Icon name={b.icon} />} title={b.title} active={b.id === type}
                onClick={() => { turnInto(ed, b.id); setPanel(null); }} />
            ))}
          </div>
        )}
        {panel === 'color' && (
          <div class="ui-panel ui-color-panel" style={dropStyle({ width: 'auto' })}>
            <div class="ui-label" style={{ marginBottom: '4px' }}>文字颜色</div>
            <div class="ui-colors" style={{ gridTemplateColumns: 'repeat(5,22px)' }}>
              {TEXT_COLORS.map(t => (
                <button type="button" class={`ui-swatch ${(color || null) === t.value ? 'is-active' : ''}`} title={t.label} style={{ color: t.value || '#c8e0f0' }}
                  onClick={() => { (t.value ? c().setColor(t.value) : c().unsetColor()).run(); }}>A</button>
              ))}
            </div>
            <div class="ui-label" style={{ margin: '8px 0 4px' }}>背景颜色</div>
            <div class="ui-colors" style={{ gridTemplateColumns: 'repeat(5,22px)' }}>
              {BG_COLORS.map(t => (
                <button type="button" class={`ui-swatch ${(bg || null) === t.value ? 'is-active' : ''}`} title={t.label}
                  style={{ background: t.value || 'transparent', color: '#c8e0f0' }}
                  onClick={() => { (t.value ? c().setBackgroundColor(t.value) : c().unsetBackgroundColor()).run(); }}>
                  {t.value ? '' : <Icon name="x" size={12} />}
                </button>
              ))}
            </div>
          </div>
        )}
        {panel === 'align' && (
          <div class="ui-panel ui-toolbar" style={dropStyle({})}>
            {[['left', 'alignLeft', '左对齐', 'L'], ['center', 'alignCenter', '居中', 'E'], ['right', 'alignRight', '右对齐', 'R'], ['justify', 'alignJustify', '两端对齐', 'J']].map(([v, ic, t, k]) => (
              <Btn title={t} kbd={`${MOD}+Shift+${k}`} active={align === v} icon={<Icon name={ic} />}
                onClick={() => { (v === 'left' ? c().unsetTextAlign() : c().setTextAlign(v)).run(); setPanel(null); }} />
            ))}
          </div>
        )}
        {panel === 'more' && (
          <div class="ui-panel ui-menu" style={dropStyle({ left: 'auto', right: 0, width: '180px', minWidth: 0 })}>
            <MenuItem compact icon={<Icon name="sup" />} title="上标" active={ed.isActive('superscript')} kbd={`${MOD}+.`} onClick={() => c().toggleSuperscript().run()} />
            <MenuItem compact icon={<Icon name="sub" />} title="下标" active={ed.isActive('subscript')} kbd={`${MOD}+,`} onClick={() => c().toggleSubscript().run()} />
            <MenuItem compact icon={<Icon name="clear" />} title="清除格式" onClick={() => { c().unsetAllMarks().run(); setPanel(null); }} />
          </div>
        )}
      </div>
    </Floating>
  );
}

/* ---------------- links ---------------- */

export function LinkEditor({ app }) {
  const ed = app.editor;
  const ref = useRef(null);
  const inputRef = useRef(null);
  const [value, setValue] = useState(() => ed.getAttributes('link').href || '');
  useDismiss(ref, () => app.closeMenu());
  useEffect(() => { setTimeout(() => inputRef.current && inputRef.current.select(), 0); }, []);
  const apply = () => {
    const href = normalizeHref(value);
    const chain = ed.chain().focus();
    if (!href) chain.extendMarkRange('link').unsetLink().run();
    else if (ed.state.selection.empty && !ed.isActive('link')) {
      chain.insertContent({ type: 'text', text: value.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
    } else chain.extendMarkRange('link').setLink({ href }).run();
    app.closeMenu();
  };
  return (
    <Floating getRect={selectionRect(ed)} placement="bottom-start" offset={8} fallback={['top-start']} className="ui-panel">
      <div ref={ref} class="ui-link-edit">
        <div class="ui-label">链接地址</div>
        <input ref={inputRef} class="ui-input" value={value} placeholder="粘贴或输入链接，回车确认" onInput={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); apply(); }
            if (e.key === 'Escape') { e.preventDefault(); app.closeMenu(); ed.commands.focus(); }
          }} />
        <div class="ui-row" style={{ justifyContent: 'space-between' }}>
          <span class="ui-hint">站内链接可以写 /blog/xxx.html</span>
          <div class="ui-row">
            {ed.isActive('link') && <button type="button" class="ui-ghost" onClick={() => { ed.chain().focus().extendMarkRange('link').unsetLink().run(); app.closeMenu(); }}>移除</button>}
            <button type="button" class="ui-primary" onClick={apply}>确定</button>
          </div>
        </div>
      </div>
    </Floating>
  );
}

export function LinkView({ app }) {
  const ed = app.editor;
  const { state } = ed;
  const $from = state.selection.$from;
  const range = getMarkRange($from, state.schema.marks.link);
  if (!range) return null;
  const href = ed.getAttributes('link').href || '';
  const getRect = () => {
    try { return posToDOMRect(ed.view, range.from, range.to); } catch { return null; }
  };
  return (
    <Floating getRect={getRect} placement="bottom-start" offset={6} fallback={['top-start']} className="ui-panel" keepFocus>
      <div class="ui-link-view">
        <Icon name="globe" size={14} />
        <span class="ui-link-url" title={href}>{href}</span>
        <span class="ui-sep" />
        <Btn title="打开" icon={<Icon name="external" />} onClick={() => app.host.openExternal(href)} />
        <Btn title="复制链接" icon={<Icon name="copy" />} onClick={() => navigator.clipboard.writeText(href).then(() => app.host.toast('已复制链接', 'success'))} />
        <Btn title="编辑" kbd={`${MOD}+K`} icon={<Icon name="blog" />} onClick={() => { ed.chain().extendMarkRange('link').run(); app.openMenu({ type: 'link', edit: true }); }} />
        <Btn title="取消链接" danger icon={<Icon name="unlink" />} onClick={() => ed.chain().focus().extendMarkRange('link').unsetLink().run()} />
      </div>
    </Floating>
  );
}

/* ---------------- figures ---------------- */

const WIDTHS = [25, 33, 50, 66, 75, 100];

export function FigureTools({ app, pos, node }) {
  const ed = app.editor;
  const dom = ed.view.nodeDOM(pos);
  if (!dom || dom.nodeType !== 1) return null;
  const img = dom.querySelector('img');
  const a = node.attrs;
  const set = patch => ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...a, ...patch }));
  const nv = nodeViewFor(dom);
  return (
    <>
      <Floating getRect={elRect(img || dom)} placement="top" offset={12} fallback={['bottom']} className="ui-panel" keepFocus sticky>
        <div class="ui-toolbar">
          <Btn title="左对齐" active={a.align === 'left'} icon={<Icon name="alignLeft" />} onClick={() => set({ align: 'left' })} />
          <Btn title="居中" active={a.align === 'center'} icon={<Icon name="alignCenter" />} onClick={() => set({ align: 'center' })} />
          <Btn title="右对齐" active={a.align === 'right'} icon={<Icon name="alignRight" />} onClick={() => set({ align: 'right' })} />
          <span class="ui-sep" />
          {[25, 50, 75, 100].map(w => (
            <Btn class="ui-width-chip" active={a.width === w} title={`宽度 ${w}%`} onClick={() => set({ width: w })} label={`${w}%`} />
          ))}
          <Btn class="ui-width-chip" active={!a.width} title="按图片原始尺寸显示（不超过正文宽度）" onClick={() => set({ width: null })} label="原始" />
          <span class="ui-sep" />
          <Btn title="图片说明" active={!!a.caption} icon={<Icon name="text" />} label="说明" onClick={() => nv && nv.startCaptionEdit(null)} />
          <Btn title="替代文字（给读屏软件和搜索引擎）" active={!!a.alt} label="Alt" onClick={() => app.openMenu({ type: 'figureAlt', pos })} />
          <span class="ui-sep" />
          <Btn title="替换图片" icon={<Icon name="refresh" />} onClick={() => app.replaceFigureImage(pos)} />
          <Btn title="在新标签页打开原图" icon={<Icon name="external" />} onClick={() => app.host.openExternal(app.displaySrc(a.src))} />
          <Btn title="删除" danger icon={<Icon name="trash" />} onClick={() => deleteBlock(ed, pos)} />
        </div>
      </Floating>
      {img && <ResizeHandles app={app} pos={pos} node={node} dom={dom} img={img} nv={nv} />}
    </>
  );
}

function ResizeHandles({ app, pos, node, dom, img, nv }) {
  const [drag, setDrag] = useState(null);
  const r = img.getBoundingClientRect();
  const sx = window.scrollX;
  const sy = window.scrollY;
  const mid = r.top + sy + r.height / 2;
  const start = (e, side) => {
    e.preventDefault();
    e.stopPropagation();
    const ed = app.editor;
    const docW = ed.view.dom.clientWidth;
    const startW = dom.getBoundingClientRect().width;
    const startX = e.clientX;
    const factor = node.attrs.align === 'center' ? 2 : 1;
    const sign = side === 'right' ? 1 : -1;
    let pct = node.attrs.width || Math.round((startW / docW) * 100);
    const move = ev => {
      const w = startW + sign * (ev.clientX - startX) * factor;
      let p = Math.round((w / docW) * 100);
      p = Math.max(10, Math.min(100, p));
      const snap = WIDTHS.find(s => Math.abs(s - p) <= 2);
      if (snap) p = snap;
      pct = p;
      nv && nv.previewWidth(p);
      setDrag({ pct: p, x: ev.clientX + window.scrollX, y: r.top + window.scrollY - 10 });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      const cur = ed.state.doc.nodeAt(pos);
      if (cur && cur.type.name === 'figure') {
        const tr = ed.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, width: pct >= 100 ? 100 : pct });
        tr.setSelection(NodeSelection.create(tr.doc, pos));
        ed.view.dispatch(tr);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <>
      <div class="ui-resize" style={{ left: r.left + sx - 1 + 'px', top: mid + 'px' }} onPointerDown={e => start(e, 'left')} title="拖动调整宽度" />
      <div class="ui-resize" style={{ left: r.right + sx + 1 + 'px', top: mid + 'px' }} onPointerDown={e => start(e, 'right')} title="拖动调整宽度" />
      {drag && <div class="ui-resize-tip" style={{ left: drag.x + 'px', top: drag.y + 'px' }}>{drag.pct}%</div>}
    </>
  );
}

export function AltEditor({ app, menu }) {
  const ed = app.editor;
  const ref = useRef(null);
  const node = ed.state.doc.nodeAt(menu.pos);
  const [value, setValue] = useState(node ? node.attrs.alt || '' : '');
  useDismiss(ref, () => app.closeMenu());
  if (!node || node.type.name !== 'figure') return null;
  const dom = ed.view.nodeDOM(menu.pos);
  const save = () => {
    ed.view.dispatch(ed.state.tr.setNodeMarkup(menu.pos, undefined, { ...node.attrs, alt: value.trim() }));
    app.closeMenu();
    ed.commands.focus();
  };
  return (
    <Floating getRect={elRect(dom)} placement="bottom" offset={8} className="ui-panel">
      <div ref={ref} class="ui-alt-edit">
        <div class="ui-label">替代文字</div>
        <input class="ui-input" autoFocus value={value} placeholder="描述图片内容，页面上不显示" onInput={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') app.closeMenu(); }} />
        <div class="ui-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" class="ui-primary" onClick={save}>保存</button>
        </div>
      </div>
    </Floating>
  );
}

/** Warnings drawn over images that failed to load or still point at another site. */
export function FigureBadges({ app }) {
  const ed = app.editor;
  const out = [];
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'figure') return true;
    const dom = ed.view.nodeDOM(pos);
    if (!dom || dom.nodeType !== 1) return false;
    const broken = dom.classList.contains('is-broken');
    const foreign = node.attrs.src && !app.isOwnImage(node.attrs.src);
    if (!broken && !foreign) return false;
    const img = dom.querySelector('img');
    const r = (img || dom).getBoundingClientRect();
    const x = r.left + window.scrollX + r.width / 2;
    const y = r.top + window.scrollY + Math.min(40, r.height / 2);
    out.push(
      <div class={`ui-badge ${broken ? 'is-error' : 'is-warn'}`} style={{ left: x + 'px', top: y + 'px' }}>
        <Icon name="alert" size={14} />
        <span>{broken ? '图片加载失败' : '外链图片，可能失效'}</span>
        {foreign && <button type="button" class="ui-ghost" style={{ height: '22px', padding: '0 6px' }} onClick={() => app.adoptForeignImages([node.attrs.src])}>转存到网站</button>}
        {broken && !foreign && <button type="button" class="ui-ghost" style={{ height: '22px', padding: '0 6px' }} onClick={() => app.replaceFigureImage(pos)}>替换</button>}
      </div>,
    );
    return false;
  });
  return out.length ? <>{out}</> : null;
}

/* ---------------- embeds ---------------- */

export function EmbedTools({ app, pos, node }) {
  const ed = app.editor;
  const dom = ed.view.nodeDOM(pos);
  if (!dom || dom.nodeType !== 1) return null;
  const nv = nodeViewFor(dom);
  const live = nv && nv.live;
  const provider = { bilibili: '哔哩哔哩', youtube: 'YouTube', itch: 'itch.io', web: '网页' }[node.attrs.provider] || '网页';
  return (
    <Floating getRect={elRect(dom)} placement="top" offset={10} fallback={['bottom']} className="ui-panel" keepFocus sticky>
      <div class="ui-toolbar">
        <span class="ui-label" style={{ padding: '0 8px' }}>{provider}</span>
        <span class="ui-sep" />
        <Btn title="在编辑器里直接操作这个嵌入内容" active={live} icon={<Icon name="play" />} label={live ? '退出交互' : '交互预览'} onClick={() => nv && nv.setLive(!live)} />
        <Btn title="打开原页面" icon={<Icon name="external" />} onClick={() => app.host.openExternal(node.attrs.src)} />
        <Btn title="修改链接" icon={<Icon name="link" />} onClick={() => app.store.set({ embedPrompt: { pos, value: node.attrs.src, replace: true } })} />
        <Btn title="删除" danger icon={<Icon name="trash" />} onClick={() => deleteBlock(ed, pos)} />
      </div>
    </Floating>
  );
}

export function EmbedPrompt({ app, prompt }) {
  const ed = app.editor;
  const ref = useRef(null);
  const [value, setValue] = useState(prompt.value || '');
  useDismiss(ref, () => app.store.set({ embedPrompt: null }));
  const info = value.trim() ? embedFromUrl(value.trim()) : null;
  const getRect = () => {
    try {
      const p = Math.min(prompt.pos, ed.state.doc.content.size);
      const c = ed.view.coordsAtPos(p);
      return new DOMRect(c.left, c.top, 1, c.bottom - c.top);
    } catch { return null; }
  };
  const submit = () => {
    if (!info) return;
    app.store.set({ embedPrompt: null });
    if (prompt.replace) {
      const node = ed.state.doc.nodeAt(prompt.pos);
      if (node && node.type.name === 'embed') ed.view.dispatch(ed.state.tr.setNodeMarkup(prompt.pos, undefined, info));
      ed.commands.focus();
      return;
    }
    insertBlocks(ed, null, [{ type: 'embed', attrs: info }]);
  };
  const label = info ? { bilibili: '哔哩哔哩视频', youtube: 'YouTube 视频', itch: 'itch.io 游戏', web: '网页（对方网站需要允许被嵌入）' }[info.provider] : '';
  return (
    <Floating getRect={getRect} placement="bottom-start" offset={8} fallback={['top-start']} className="ui-panel">
      <div ref={ref} class="ui-link-edit" style={{ width: '380px' }}>
        <div class="ui-label">嵌入视频或网页</div>
        <input class="ui-input" autoFocus value={value} placeholder="粘贴 B 站、YouTube、itch.io 链接或任意网址" onInput={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); app.store.set({ embedPrompt: null }); ed.commands.focus(); }
          }} />
        <div class="ui-row" style={{ justifyContent: 'space-between' }}>
          <span class="ui-hint">{value.trim() ? (info ? `识别为：${label}` : '链接格式不正确') : 'B 站视频页链接会自动转成播放器'}</span>
          <button type="button" class="ui-primary" disabled={!info} onClick={submit}>{prompt.replace ? '更新' : '插入'}</button>
        </div>
      </div>
    </Floating>
  );
}

export function PasteUrlOffer({ app, menu }) {
  const ed = app.editor;
  const ref = useRef(null);
  useDismiss(ref, () => app.closeMenu());
  const info = embedFromUrl(menu.url);
  const node = ed.state.doc.nodeAt(menu.pos);
  if (!info || !node || node.type.name !== 'paragraph' || node.textContent.trim() !== menu.url) return null;
  const dom = ed.view.nodeDOM(menu.pos);
  const toEmbed = () => {
    const tr = ed.state.tr.replaceWith(menu.pos, menu.pos + node.nodeSize, ed.state.schema.nodes.embed.create(info));
    tr.setSelection(NodeSelection.create(tr.doc, menu.pos));
    ed.view.dispatch(tr);
    app.closeMenu();
  };
  const label = info.provider === 'web' ? '显示为网页嵌入' : '显示为视频播放器';
  return (
    <Floating getRect={elRect(dom)} placement="bottom-start" offset={6} className="ui-panel" keepFocus>
      <div ref={ref} class="ui-toolbar">
        <Btn icon={<Icon name="embed" />} label={label} onClick={toEmbed} />
        <Btn icon={<Icon name="link" />} label="保持链接" onClick={() => app.closeMenu()} />
      </div>
    </Floating>
  );
}

/* ---------------- tables ---------------- */

function tableAround(state) {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') return { pos: $from.before(d), node: $from.node(d) };
  }
  return null;
}

export function TableTools({ app }) {
  const ed = app.editor;
  const [panel, setPanel] = useState(null);
  const t = tableAround(ed.state);
  if (!t) return null;
  const dom = ed.view.nodeDOM(t.pos);
  if (!dom || dom.nodeType !== 1) return null;
  const c = () => ed.chain().focus();
  const cellSel = ed.state.selection instanceof CellSelection;
  const cellBg = ed.getAttributes('tableCell').background || ed.getAttributes('tableHeader').background || null;
  return (
    <Floating getRect={elRect(dom)} placement="top-start" offset={8} fallback={['bottom-start']} className="ui-panel" keepFocus sticky>
      <div class="ui-toolbar" style={{ position: 'relative' }}>
        <Btn title="在上方插入行" icon={<Icon name="rowAbove" />} onClick={() => c().addRowBefore().run()} />
        <Btn title="在下方插入行" icon={<Icon name="rowBelow" />} onClick={() => c().addRowAfter().run()} />
        <Btn title="在左侧插入列" icon={<Icon name="colLeft" />} onClick={() => c().addColumnBefore().run()} />
        <Btn title="在右侧插入列" icon={<Icon name="colRight" />} onClick={() => c().addColumnAfter().run()} />
        <span class="ui-sep" />
        <Btn title="删除所在行" label="删行" onClick={() => c().deleteRow().run()} />
        <Btn title="删除所在列" label="删列" onClick={() => c().deleteColumn().run()} />
        <span class="ui-sep" />
        <Btn title="合并选中的单元格（先拖选多个单元格）" disabled={!cellSel} icon={<Icon name="merge" />} onClick={() => c().mergeCells().run()} />
        <Btn title="拆分单元格" disabled={!ed.can().splitCell()} icon={<Icon name="split" />} onClick={() => c().splitCell().run()} />
        <Btn title="第一行作为表头" icon={<Icon name="headerRow" />} onClick={() => c().toggleHeaderRow().run()} />
        <Btn title="单元格背景色" onClick={() => setPanel(panel === 'bg' ? null : 'bg')}>
          <span style={{ width: '14px', height: '14px', borderRadius: '3px', border: '1px solid rgba(255,255,255,.3)', background: cellBg ? (CELL_COLORS.find(x => x.id === cellBg) || {}).value : 'transparent' }} />
          <Icon name="down" size={12} className="ui-caret" />
        </Btn>
        <span class="ui-sep" />
        <Btn title="删除表格" danger icon={<Icon name="trash" />} onClick={() => c().deleteTable().run()} />
        {panel === 'bg' && (
          <div class="ui-panel ui-color-panel" style={{ position: 'absolute', right: '30px', top: 'calc(100% + 6px)' }}>
            <div class="ui-label" style={{ marginBottom: '4px' }}>单元格背景</div>
            <div class="ui-colors" style={{ gridTemplateColumns: 'repeat(5,22px)' }}>
              <button type="button" class={`ui-swatch ${!cellBg ? 'is-active' : ''}`} title="无" onClick={() => { c().setCellAttribute('background', null).run(); setPanel(null); }}><Icon name="x" size={12} /></button>
              {CELL_COLORS.map(col => (
                <button type="button" class={`ui-swatch ${cellBg === col.id ? 'is-active' : ''}`} title={col.label} style={{ background: col.value }}
                  onClick={() => { c().setCellAttribute('background', col.id).run(); setPanel(null); }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Floating>
  );
}

/* ---------------- code blocks ---------------- */

export function CodeTools({ app, pos }) {
  const ed = app.editor;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const node = ed.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'codeBlock') return null;
  const dom = ed.view.nodeDOM(pos);
  if (!dom || dom.nodeType !== 1) return null;
  const lang = node.attrs.language || 'plaintext';
  const getRect = () => {
    if (!dom.isConnected) return null;
    const r = dom.getBoundingClientRect();
    return new DOMRect(r.right - 6, r.top + 6, 0, 0);
  };
  const setLang = id => {
    ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: id }));
    setOpen(false);
    setQ('');
    ed.commands.focus();
  };
  const list = LANGUAGES.filter(l => !q || l.label.toLowerCase().includes(q.toLowerCase()) || l.id.includes(q.toLowerCase()) || l.aliases.includes(q.toLowerCase()));
  return (
    <Floating getRect={getRect} placement="bottom-end" offset={0} fallback={[]} className="ui-panel" keepFocus style={{ zIndex: 12 }}>
      <div class="ui-code-bar" style={{ position: 'relative' }}>
        <Btn title="代码语言" label={languageLabel(lang) || '纯文本'} onClick={() => setOpen(!open)}>
          <Icon name="down" size={12} className="ui-caret" />
        </Btn>
        <Btn title="复制代码" icon={<Icon name="copy" />} onClick={() => navigator.clipboard.writeText(node.textContent).then(() => app.host.toast('代码已复制', 'success'))} />
        {open && (
          <div class="ui-panel ui-menu ui-lang-list" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)' }}>
            <input class="ui-input ui-lang-search" autoFocus placeholder="搜索语言" value={q} onInput={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && list[0]) setLang(list[0].id);
                if (e.key === 'Escape') { setOpen(false); ed.commands.focus(); }
              }} />
            {list.map(l => <MenuItem compact title={l.label} active={l.id === lang} onClick={() => setLang(l.id)} />)}
          </div>
        )}
      </div>
    </Floating>
  );
}

/* ---------------- callouts ---------------- */

export function CalloutPicker({ app, menu }) {
  const ed = app.editor;
  const ref = useRef(null);
  useDismiss(ref, () => app.closeMenu());
  const node = ed.state.doc.nodeAt(menu.pos);
  if (!node || node.type.name !== 'callout') return null;
  const dom = ed.view.nodeDOM(menu.pos);
  const set = patch => ed.view.dispatch(ed.state.tr.setNodeMarkup(menu.pos, undefined, { ...node.attrs, ...patch }));
  const getRect = () => {
    if (!dom || !dom.isConnected) return null;
    const r = dom.getBoundingClientRect();
    return new DOMRect(r.left + 10, r.top + 8, 30, 30);
  };
  const unwrap = () => {
    ed.chain().focus().command(({ tr }) => {
      tr.setSelection(TextSelection.between(tr.doc.resolve(menu.pos + 1), tr.doc.resolve(menu.pos + node.nodeSize - 1)));
      return true;
    }).lift('callout').run();
    app.closeMenu();
  };
  return (
    <Floating getRect={getRect} placement="bottom-start" offset={6} className="ui-panel" keepFocus>
      <div ref={ref}>
        <div class="ui-emoji-grid">
          {CALLOUT_EMOJIS.map(e => (
            <button type="button" class={`ui-emoji ${node.attrs.emoji === e ? 'is-active' : ''}`} onClick={() => set({ emoji: e })}>{e}</button>
          ))}
        </div>
        <div class="ui-callout-colors">
          {CALLOUT_COLORS.map(col => (
            <button type="button" class={`ui-callout-color ${node.attrs.color === col ? 'is-active' : ''}`} title={col}
              style={{ background: CALLOUT_COLOR_SWATCH[col] }} onClick={() => set({ color: col })} />
          ))}
          <span style={{ flex: 1 }} />
          <button type="button" class="ui-ghost" style={{ height: '26px' }} onClick={unwrap}>取消高亮块</button>
        </div>
      </div>
    </Floating>
  );
}

