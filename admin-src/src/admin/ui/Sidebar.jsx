import { useRef, useState } from 'preact/hooks';
import { Icon, StatusDot, useMenu, MOD } from './common.jsx';

const SECTIONS = [
  { key: 'post', title: '文章', icon: 'blog', add: '新建文章' },
  { key: 'work', title: '项目', icon: 'gamepad', add: '新建项目' },
  { key: 'gallery', title: '画廊', icon: 'palette', add: '新建分类' },
];

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem('devlog_admin_collapsed') || '{}'); } catch { return {}; }
}

function matches(meta, q) {
  if (!q) return true;
  const hay = `${meta.title || ''} ${meta.slug || ''} ${(meta.tags || []).join(' ')} ${meta.cat || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}

export function Sidebar({ shell, st }) {
  const data = shell.data;
  const ws = data.ws;
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [drag, setDrag] = useState(null);
  const [drop, setDrop] = useState(null);
  const menu = useMenu();
  const searchRef = useRef(null);
  const q = st.search.trim();
  shell.focusSearch = () => { if (searchRef.current) { searchRef.current.focus(); searchRef.current.select(); } };

  const toggle = key => {
    const next = { ...collapsed, [key]: !collapsed[key] };
    setCollapsed(next);
    localStorage.setItem('devlog_admin_collapsed', JSON.stringify(next));
  };

  const docMenu = (e, id) => {
    const found = data.find(id);
    if (!found) return;
    const published = !!data.pubOf(id);
    const url = shell.liveUrl(id);
    const cats = found.kind === 'galleryItem' ? ws.gallery.filter(c => c.id !== found.cat.id) : [];
    menu.open(e, [
      { icon: 'external', text: '打开线上页面', disabled: !published, run: () => window.open(url, '_blank', 'noopener') },
      { icon: 'link', text: '复制线上链接', disabled: !published, run: () => navigator.clipboard.writeText(url).then(() => shell.toast('链接已复制', 'success')) },
      '-',
      found.kind !== 'about' && { icon: 'duplicate', text: '创建副本', run: () => shell.duplicateDoc(id) },
      ...(cats.length ? [{ label: '移动到分类' }, ...cats.map(c => ({ icon: 'folder', text: c.name, run: () => { data.moveGalleryItem(id, c.id); shell.pushMeta(id); } }))] : []),
      '-',
      { icon: 'history', text: '历史版本', run: () => { shell.openDoc(id); shell.openDialog({ type: 'history', docId: id }); } },
      published && { icon: 'cloudOff', text: '从网站撤下', run: () => shell.unpublishDoc(id) },
      found.kind !== 'about' && { icon: 'trash', text: '移到回收站', danger: true, run: () => shell.trashDoc(id) },
    ]);
  };

  const catMenu = (e, cat) => {
    menu.open(e, [
      { icon: 'plus', text: '在此分类新建作品', run: () => shell.createDoc('galleryItem', { catId: cat.id }) },
      '-',
      { icon: 'text', text: '重命名分类', run: async () => {
        const name = await shell.prompt({ title: '重命名分类', label: '分类名称（显示在画廊页上）', value: cat.name });
        if (name) { data.updateCategory(cat.id, { name }); shell.pushMeta(shell.store.get().currentId); }
      } },
      { icon: 'link', text: '修改分类链接', run: async () => {
        const slug = await shell.prompt({ title: '修改分类链接', label: `网址：/gallery/<链接名>/　当前：${cat.slug}`, value: cat.slug });
        if (slug) data.updateCategory(cat.id, { slug });
      } },
      '-',
      { icon: 'trash', text: cat.items.length ? '删除分类（需先清空）' : '删除分类', danger: true, disabled: !!cat.items.length, run: () => data.deleteCategory(cat.id) },
    ]);
  };

  const addFor = async key => {
    if (key === 'gallery') {
      const res = await shell.prompt({
        title: '新建画廊分类', ok: '创建',
        fields: [
          { name: 'name', label: '分类名称', placeholder: '例如：原创插画' },
          { name: 'slug', label: '链接名（英文，出现在网址里）', placeholder: '例如：illust', mono: true },
        ],
      });
      if (res && res.name) {
        data.createCategory(res.name.trim(), res.slug);
        if (collapsed.gallery) toggle('gallery');
      }
      return;
    }
    if (collapsed[key]) toggle(key);
    shell.createDoc(key);
  };

  /* ---------- drag & drop ordering ---------- */
  const onDragStart = (e, item) => {
    setDrag(item);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
  };
  const onDragOver = (e, target) => {
    if (!drag) return;
    const sameList = drag.kind === target.kind && (drag.kind !== 'galleryItem' || target.kind === 'galleryItem');
    const intoCat = drag.kind === 'galleryItem' && target.kind === 'category';
    const catOnCat = drag.kind === 'category' && target.kind === 'category';
    if (!sameList && !intoCat && !catOnCat) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const where = intoCat ? 'into' : (e.clientY < r.top + r.height / 2 ? 'before' : 'after');
    if (!drop || drop.id !== target.id || drop.where !== where) setDrop({ id: target.id, where });
  };
  const onDrop = (e, target) => {
    e.preventDefault();
    const d = drag;
    const where = drop && drop.where;
    setDrag(null);
    setDrop(null);
    if (!d || d.id === target.id) return;
    if (d.kind === 'galleryItem' && target.kind === 'category') {
      data.moveGalleryItem(d.id, target.id, 0);
      shell.pushMeta(d.id);
      return;
    }
    if (d.kind === 'category') {
      const ids = ws.gallery.map(c => c.id).filter(id => id !== d.id);
      const at = ids.indexOf(target.id) + (where === 'after' ? 1 : 0);
      ids.splice(at, 0, d.id);
      data.reorder('category', ids);
      return;
    }
    if (d.kind === 'galleryItem') {
      const src = data.find(d.id);
      const dst = data.find(target.id);
      if (!src || !dst) return;
      if (src.cat.id !== dst.cat.id) {
        const idx = dst.cat.items.indexOf(dst.meta) + (where === 'after' ? 1 : 0);
        data.moveGalleryItem(d.id, dst.cat.id, idx);
        shell.pushMeta(d.id);
        return;
      }
      const ids = src.cat.items.map(i => i.id).filter(id => id !== d.id);
      ids.splice(ids.indexOf(target.id) + (where === 'after' ? 1 : 0), 0, d.id);
      data.reorder('galleryItem', ids, src.cat.id);
      return;
    }
    const list = d.kind === 'post' ? ws.posts : ws.works;
    const ids = list.map(m => m.id).filter(id => id !== d.id);
    ids.splice(ids.indexOf(target.id) + (where === 'after' ? 1 : 0), 0, d.id);
    data.reorder(d.kind, ids);
  };
  const onDragEnd = () => { setDrag(null); setDrop(null); };
  const dropClass = id => (drop && drop.id === id ? ` drop-${drop.where}` : '');

  const docRow = (meta, kind, nested = false) => {
    if (!matches(meta, q)) return null;
    const id = meta.id;
    const status = data.status(id);
    const conflict = st.conflicts.includes(id);
    return (
      <div key={id}
        class={`sb-row${nested ? ' is-nested' : ''}${st.currentId === id ? ' is-active' : ''}${drag && drag.id === id ? ' is-dragging' : ''}${dropClass(id)}`}
        draggable={!q && kind !== 'about'}
        onDragStart={e => onDragStart(e, { id, kind })}
        onDragOver={e => onDragOver(e, { id, kind })}
        onDrop={e => onDrop(e, { id, kind })}
        onDragEnd={onDragEnd}
        onClick={() => shell.openDoc(id)}
        onContextMenu={e => docMenu(e, id)}
        title={meta.title || '无标题'}>
        <span class={`sb-row-title${meta.title ? '' : ' is-untitled'}`}>{meta.title || '无标题'}</span>
        <StatusDot status={status} conflict={conflict} />
        <button type="button" class="icon-btn is-small" title="更多" onClick={e => docMenu(e, id)}><Icon name="more" size={14} /></button>
      </div>
    );
  };

  const section = (sec, count, content) => (
    <div class="sb-section" key={sec.key}>
      <div class={`sb-sec-head${collapsed[sec.key] && !q ? ' is-collapsed' : ''}`}>
        <span class="sb-caret" onClick={() => toggle(sec.key)}><Icon name="down" size={12} /></span>
        <span class="sb-sec-title" onClick={() => toggle(sec.key)}><Icon name={sec.icon} size={14} />{sec.title}<span class="sb-count">{count}</span></span>
        <button type="button" class="icon-btn is-small" title={sec.add} onClick={() => addFor(sec.key)}><Icon name="plus" size={14} /></button>
      </div>
      {(!collapsed[sec.key] || q) && content}
    </div>
  );

  const posts = ws.posts.map(m => docRow(m, 'post')).filter(Boolean);
  const works = ws.works.map(m => docRow(m, 'work')).filter(Boolean);
  const itemCount = ws.gallery.reduce((n, c) => n + c.items.length, 0);

  return (
    <aside class="sidebar">
      <div class="sb-head">
        <div class="sb-logo">_DEV.LOG<small>后台</small></div>
        <button type="button" class="icon-btn" title={`收起侧边栏 (${MOD}+\\)`} onClick={() => shell.setUI({ sidebar: false })}><Icon name="sidebar" size={16} /></button>
      </div>
      <div class="sb-search">
        <Icon name="search" size={14} />
        <input ref={searchRef} class="input" placeholder="搜索文档" value={st.search}
          onInput={e => shell.store.set({ search: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Escape') { shell.store.set({ search: '' }); e.target.blur(); }
            if (e.key === 'Enter') {
              const first = data.allDocs().find(d => matches(d.meta, st.search.trim()));
              if (first) shell.openDoc(first.id);
            }
          }} />
        {!st.search && <span class="kbd">{MOD} P</span>}
      </div>
      <div class="sb-tree">
        {section(SECTIONS[0], ws.posts.length, posts.length ? posts : <div class="sb-empty">{q ? '没有匹配的文章' : '还没有文章'}</div>)}
        {section(SECTIONS[1], ws.works.length, works.length ? works : <div class="sb-empty">{q ? '没有匹配的项目' : '还没有项目'}</div>)}
        {section(SECTIONS[2], itemCount, ws.gallery.length ? ws.gallery.map(cat => {
          const items = cat.items.map(m => docRow(m, 'galleryItem', true)).filter(Boolean);
          if (q && !items.length) return null;
          const key = 'cat:' + cat.id;
          return (
            <div key={cat.id}>
              <div class={`sb-row is-cat${drag && drag.id === cat.id ? ' is-dragging' : ''}${dropClass(cat.id)}`}
                draggable={!q}
                onDragStart={e => onDragStart(e, { id: cat.id, kind: 'category' })}
                onDragOver={e => onDragOver(e, { id: cat.id, kind: 'category' })}
                onDrop={e => onDrop(e, { id: cat.id, kind: 'category' })}
                onDragEnd={onDragEnd}
                onClick={() => toggle(key)}
                onContextMenu={e => catMenu(e, cat)}>
                <span class="sb-caret" style={{ transform: collapsed[key] && !q ? 'rotate(-90deg)' : '', display: 'grid', width: '16px' }}><Icon name="down" size={11} /></span>
                <Icon name="folder" size={14} />
                <span class="sb-row-title">{cat.name}</span>
                <span class="sb-count">{cat.items.length}</span>
                <button type="button" class="icon-btn is-small" title="在此分类新建作品" onClick={e => { e.stopPropagation(); shell.createDoc('galleryItem', { catId: cat.id }); }}><Icon name="plus" size={14} /></button>
                <button type="button" class="icon-btn is-small" title="分类设置" onClick={e => catMenu(e, cat)}><Icon name="more" size={14} /></button>
              </div>
              {(!collapsed[key] || q) && (items.length ? items : <div class="sb-empty" style={{ paddingLeft: '42px' }}>空分类</div>)}
            </div>
          );
        }) : <div class="sb-empty">还没有分类，点 + 新建</div>)}
        {(!q || matches(ws.about || {}, q)) && (
          <div class="sb-section">
            {ws.about ? (
              <div class={`sb-row${st.currentId === ws.about.id ? ' is-active' : ''}`} style={{ paddingLeft: '12px' }}
                onClick={() => shell.openDoc(ws.about.id)} onContextMenu={e => docMenu(e, ws.about.id)}>
                <Icon name="user" size={14} />
                <span class="sb-row-title" style={{ fontWeight: 700, fontSize: '12px', color: 'var(--muted)' }}>关于我</span>
                <StatusDot status={data.status(ws.about.id)} conflict={st.conflicts.includes(ws.about.id)} />
                <button type="button" class="icon-btn is-small" title="更多" onClick={e => docMenu(e, ws.about.id)}><Icon name="more" size={14} /></button>
              </div>
            ) : (
              <div class="sb-row" style={{ paddingLeft: '12px' }} onClick={() => shell.createDoc('about')}>
                <Icon name="user" size={14} /><span class="sb-row-title muted">创建“关于我”页面</span>
              </div>
            )}
          </div>
        )}
      </div>
      <div class="sb-foot">
        <div class="sb-foot-row" onClick={() => shell.openDialog({ type: 'library' })}><Icon name="image" size={15} />图片库</div>
        <div class="sb-foot-row" onClick={() => shell.openDialog({ type: 'trash' })}><Icon name="trash" size={15} />回收站{ws.trash.length ? <span class="sb-count">{ws.trash.length}</span> : null}</div>
        <div class="sb-foot-row" onClick={() => shell.openDialog({ type: 'settings' })}><Icon name="settings" size={15} />设置</div>
      </div>
      {menu.node}
    </aside>
  );
}
