import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../shared/icons.jsx';
import { safeFocus, todayISO } from '../../shared/util.js';
import { Floating, MenuItem, useDismiss, elRect } from './Floating.jsx';

function fieldEl(field) {
  if (field === 'tags') {
    return document.querySelector('.post-meta[data-field="meta"]') || document.querySelector('[data-field="tags"]');
  }
  if (field === 'focus') return document.querySelector('[data-field="cover"], [data-field="image"]');
  return document.querySelector(`[data-field="${field}"]`);
}

function useOpenMark(el) {
  useEffect(() => {
    if (!el) return undefined;
    el.classList.add('is-open');
    return () => el.classList.remove('is-open');
  }, [el]);
}

export function FieldPopover({ app, menu }) {
  const ref = useRef(null);
  const el = (menu.el && menu.el.isConnected ? menu.el : null) || fieldEl(menu.field) || document.querySelector('[data-zone="header"]');
  useOpenMark(el);
  useDismiss(ref, () => app.closeMenu(), [el]);
  const meta = app.store.get().meta || {};
  const kind = app.store.get().kind;
  let body = null;
  const f = menu.field;
  if (f === 'cat') body = <CategoryPop app={app} meta={meta} />;
  else if (f === 'date') body = <DatePop app={app} meta={meta} />;
  else if (f === 'tags') body = <TagsPop app={app} meta={meta} kind={kind} />;
  else if (f === 'cover') body = <CoverPop app={app} meta={meta} kind={kind} />;
  else if (f === 'play') body = <UrlPop app={app} field="play" meta={meta} title="在线游玩地址" hint="填 itch.io 的嵌入地址或任意可嵌入的网页游戏地址。页面上会显示「开始游戏」按钮，访客点按后才加载。" />;
  else if (f === 'link') body = <UrlPop app={app} field="link" meta={meta} title="项目链接" hint="页面底部「查看项目 →」按钮指向的地址。" />;
  else if (f === 'category') body = <GalleryCategoryPop app={app} meta={meta} />;
  else if (f === 'image') body = <GalleryImagePop app={app} meta={meta} />;
  else if (f === 'focus') body = <FocusPop app={app} meta={meta} kind={kind} />;
  if (!body) return null;
  return (
    <Floating getRect={elRect(el)} placement={menu.placement || 'bottom-start'} offset={10} fallback={['top-start', 'bottom-end']} className="ui-panel">
      <div ref={ref} class="ui-field-pop">{body}</div>
    </Floating>
  );
}

function CategoryPop({ app, meta }) {
  const [q, setQ] = useState('');
  const cats = app.host.suggestions('post').cats || [];
  const current = meta.cat || '';
  const list = cats.filter(c => !q || c.toLowerCase().includes(q.toLowerCase()));
  const choose = name => {
    app.patchMeta({ cat: name });
    app.closeMenu();
  };
  const exists = cats.some(c => c === q.trim());
  return (
    <>
      <div class="ui-label">文章分类</div>
      <input class="ui-input" autoFocus placeholder="搜索或新建分类" value={q} onInput={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && q.trim()) choose(q.trim()); }} />
      <div class="ui-menu" style={{ padding: 0, maxHeight: '220px' }}>
        {q.trim() && !exists && <MenuItem compact icon={<Icon name="plus" />} title={`新建分类「${q.trim()}」`} onClick={() => choose(q.trim())} />}
        {list.map(c => <MenuItem compact icon={c === current ? <Icon name="check" /> : <span />} title={c} active={c === current} onClick={() => choose(c)} />)}
        <MenuItem compact icon={!current ? <Icon name="check" /> : <span />} title="未分类" active={!current} onClick={() => choose('')} />
      </div>
    </>
  );
}

function DatePop({ app, meta }) {
  const [v, setV] = useState(meta.date || todayISO());
  const save = val => {
    app.patchMeta({ date: val });
    app.closeMenu();
  };
  return (
    <>
      <div class="ui-label">发布日期</div>
      <input class="ui-input" type="date" value={v} onInput={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(v); }} style={{ colorScheme: 'dark' }} />
      <div class="ui-row" style={{ justifyContent: 'space-between' }}>
        <button type="button" class="ui-ghost" onClick={() => save(todayISO())}>今天</button>
        <button type="button" class="ui-primary" onClick={() => save(v)}>确定</button>
      </div>
    </>
  );
}

function TagsPop({ app, meta, kind }) {
  const [q, setQ] = useState('');
  const tags = meta.tags || [];
  const all = app.host.suggestions(kind).tags || [];
  const suggest = all.filter(t => !tags.includes(t) && (!q || t.toLowerCase().includes(q.toLowerCase()))).slice(0, 12);
  const add = t => {
    const v = t.trim();
    if (!v || tags.includes(v)) return;
    app.patchMeta({ tags: [...tags, v] });
    setQ('');
  };
  const remove = t => app.patchMeta({ tags: tags.filter(x => x !== t) });
  return (
    <>
      <div class="ui-label">{kind === 'post' ? '标签（显示在日期后面）' : '标签'}</div>
      {kind === 'post' && <div class="ui-row"><button type="button" class="ui-ghost" onClick={() => app.openField('date', document.querySelector('[data-field="date"]'))}><Icon name="calendar" size={14} /> 修改日期：{meta.date || '未设置'}</button></div>}
      <div class="ui-chips">
        {tags.map(t => (
          <span class="ui-chip">{t}<button type="button" title="移除" onClick={() => remove(t)}><Icon name="x" size={11} /></button></span>
        ))}
        {!tags.length && <span class="ui-hint">还没有标签</span>}
      </div>
      <input class="ui-input" autoFocus placeholder="输入标签，回车添加" value={q} onInput={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); add(q); }
          if (e.key === 'Backspace' && !q && tags.length) remove(tags[tags.length - 1]);
        }} />
      {!!suggest.length && (
        <div class="ui-chips">
          {suggest.map(t => <button type="button" class="ui-chip is-suggest" onClick={() => add(t)}>+ {t}</button>)}
        </div>
      )}
    </>
  );
}

async function pickFile(accept = 'image/*') {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

function CoverPop({ app, meta, kind }) {
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    const file = await pickFile();
    if (!file) return;
    setBusy(true);
    try {
      const [r] = await app.host.processImages([file], 'cover');
      if (r) app.patchMeta(kind === 'work' ? { cover: r.src, coverFull: r.full || r.src, coverPos: '50% 50%' } : { cover: r.src, coverPos: '50% 50%' });
      app.closeMenu();
    } finally {
      setBusy(false);
    }
  };
  const library = async () => {
    const [p] = (await app.host.pickImage({ multiple: false })) || [];
    if (p) app.patchMeta(kind === 'work' ? { cover: p.src, coverFull: p.src, coverPos: '50% 50%' } : { cover: p.src, coverPos: '50% 50%' });
    app.closeMenu();
  };
  const remove = () => {
    app.patchMeta(kind === 'work' ? { cover: '', coverFull: '', coverPos: '50% 50%' } : { cover: '', coverPos: '50% 50%' });
    app.closeMenu();
  };
  return (
    <>
      <div class="ui-label">{kind === 'work' ? '项目封面（也用在项目卡片上）' : '文章封面（也用在博客卡片上）'}</div>
      <div class="ui-menu" style={{ padding: 0 }}>
        <MenuItem compact icon={busy ? <span class="ui-spinner" /> : <Icon name="upload" />} title={meta.cover ? '上传新封面' : '上传封面'} onClick={upload} />
        <MenuItem compact icon={<Icon name="gallery" />} title="从图库选择" onClick={library} />
        {meta.cover && <MenuItem compact icon={<Icon name="focus" />} title="调整显示焦点" desc="封面被裁切时保留哪一块" onClick={() => app.openField('focus', null)} />}
        {meta.cover && <MenuItem compact danger icon={<Icon name="trash" />} title="移除封面" onClick={remove} />}
      </div>
    </>
  );
}

function UrlPop({ app, field, meta, title, hint }) {
  const [v, setV] = useState(meta[field] || '');
  const save = val => {
    app.patchMeta({ [field]: val.trim() });
    app.closeMenu();
  };
  return (
    <>
      <div class="ui-label">{title}</div>
      <input class="ui-input" autoFocus placeholder="https://" value={v} onInput={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(v); }} />
      <div class="ui-hint">{hint}</div>
      <div class="ui-row" style={{ justifyContent: 'space-between' }}>
        {meta[field] ? <button type="button" class="ui-ghost" onClick={() => save('')}>移除</button> : <span />}
        <button type="button" class="ui-primary" onClick={() => save(v)}>确定</button>
      </div>
    </>
  );
}

function GalleryCategoryPop({ app, meta }) {
  const cats = app.host.galleryCategories() || [];
  const current = meta.catId;
  return (
    <>
      <div class="ui-label">移动到分类</div>
      <div class="ui-menu" style={{ padding: 0 }}>
        {cats.map(c => (
          <MenuItem compact icon={c.id === current ? <Icon name="check" /> : <span />} title={c.name} active={c.id === current}
            onClick={() => { if (c.id !== current) app.host.moveGalleryItem(app.doc.docId, c.id); app.closeMenu(); }} />
        ))}
      </div>
      <div class="ui-hint">分类的新建、改名在左侧目录里操作。</div>
    </>
  );
}

function GalleryImagePop({ app, meta }) {
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    const file = await pickFile();
    if (!file) return;
    setBusy(true);
    try {
      const [r] = await app.host.processImages([file], 'gallery');
      if (r) app.patchMeta({ img: r.src, imgFull: r.full || r.src, imgPos: '50% 50%' });
      app.closeMenu();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div class="ui-label">作品图片</div>
      <div class="ui-menu" style={{ padding: 0 }}>
        <MenuItem compact icon={busy ? <span class="ui-spinner" /> : <Icon name="upload" />} title={meta.img ? '更换图片' : '上传图片'} desc="会同时生成缩略图和原图" onClick={upload} />
        {meta.img && <MenuItem compact icon={<Icon name="focus" />} title="调整卡片裁切焦点" desc="分类页卡片是 3:4 竖图" onClick={() => app.openField('focus', null)} />}
        {meta.imgFull && <MenuItem compact icon={<Icon name="external" />} title="查看原图" onClick={() => { app.host.openExternal(app.displaySrc(meta.imgFull)); app.closeMenu(); }} />}
      </div>
    </>
  );
}

const FOCUS_PREVIEW = {
  post: { key: 'coverPos', src: m => m.cover, ratio: 320 / 180, label: '博客卡片' },
  work: { key: 'coverPos', src: m => m.cover, ratio: 320 / 200, label: '项目卡片' },
  galleryItem: { key: 'imgPos', src: m => m.img, ratio: 3 / 4, label: '分类页卡片' },
};

function FocusPop({ app, meta, kind }) {
  const cfg = FOCUS_PREVIEW[kind] || FOCUS_PREVIEW.post;
  const [pos, setPos] = useState(() => safeFocus(meta[cfg.key]));
  const boxRef = useRef(null);
  const src = app.displaySrc(cfg.src(meta));
  const [px, py] = pos.split(' ').map(v => parseFloat(v));
  const pick = e => {
    const r = boxRef.current.getBoundingClientRect();
    const x = Math.round(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
    const y = Math.round(Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)));
    const next = `${x}% ${y}%`;
    setPos(next);
    app.patchMeta({ [cfg.key]: next });
  };
  const onDown = e => {
    e.preventDefault();
    pick(e);
    const move = ev => pick(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <>
      <div class="ui-label">点选画面中要保留的位置</div>
      <div ref={boxRef} style={{ position: 'relative', cursor: 'crosshair', lineHeight: 0 }} onPointerDown={onDown}>
        <img src={src} alt="" draggable={false} style={{ width: '100%', display: 'block', borderRadius: '4px', userSelect: 'none' }} />
        <span class="ui-focus-dot" style={{ left: px + '%', top: py + '%' }} />
      </div>
      <div class="ui-label">{cfg.label}预览</div>
      <div style={{ width: '100%', aspectRatio: String(cfg.ratio), overflow: 'hidden', borderRadius: '4px', border: '1px solid rgba(0,245,255,.2)' }}>
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: pos, display: 'block' }} />
      </div>
      <div class="ui-row" style={{ justifyContent: 'space-between' }}>
        <button type="button" class="ui-ghost" onClick={() => { setPos('50% 50%'); app.patchMeta({ [cfg.key]: '50% 50%' }); }}>居中</button>
        <button type="button" class="ui-primary" onClick={() => app.closeMenu()}>完成</button>
      </div>
    </>
  );
}

/** Ghost buttons above the header for optional fields that are not on the page yet. */
export function HeaderAddRow({ app, st }) {
  const zone = document.querySelector('[data-zone="header"]');
  if (!zone || !st.meta || st.readOnly) return null;
  const m = st.meta;
  const items = [];
  if (st.kind === 'post') {
    if (!m.cover) items.push(['image', '添加封面', () => app.openField('cover', zone)]);
    if (!(m.tags || []).length) items.push(['tag', '添加标签', () => app.openField('tags', null)]);
  } else if (st.kind === 'work') {
    if (!m.cover) items.push(['image', '添加封面', () => app.openField('cover', zone)]);
    if (!m.play) items.push(['gamepad', '添加在线游玩', () => app.openField('play', zone)]);
    if (!m.link) items.push(['link', '添加项目链接', () => app.openField('link', zone)]);
    if (!(m.tags || []).length) items.push(['tag', '添加标签', () => app.openField('tags', zone)]);
  } else if (st.kind === 'galleryItem') {
    if (!m.img) items.push(['image', '添加作品图片', () => app.openField('image', zone)]);
  }
  if (!items.length) return null;
  const r = zone.firstElementChild ? zone.firstElementChild.getBoundingClientRect() : zone.getBoundingClientRect();
  const left = r.left + window.scrollX;
  const top = r.top + window.scrollY - 36;
  return (
    <div class="ui-media-bar" style={{ position: 'absolute', left: left + 'px', top: top + 'px', opacity: st.headerHover ? 1 : 0, transition: 'opacity .15s', pointerEvents: st.headerHover ? 'auto' : 'none' }}>
      {items.map(([icon, label, fn]) => (
        <button type="button" class="ui-add-cover" onClick={fn}><Icon name={icon} size={14} />{label}</button>
      ))}
    </div>
  );
}
