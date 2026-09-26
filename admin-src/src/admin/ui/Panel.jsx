import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon, relTime, STATUS_TEXT } from './common.jsx';
import { SITE_CSS } from '../assets.js';
import { FONTS_HREF, blogCardHTML, workCardHTML, galleryItemCardHTML } from '../../shared/templates.js';
import { LAYOUT_DEFAULTS, LAYOUT_LIMITS, normLayout, cleanSlug } from '../../shared/util.js';

const SLUG_PREFIX = { post: '/blog/', work: '/works/', galleryItem: '/gallery/' };

export function Panel({ shell, st }) {
  const found = st.currentId ? shell.data.find(st.currentId) : null;
  const tab = st.panelTab;
  return (
    <aside class="panel">
      <div class="pn-tabs">
        {[['page', '页面'], ['outline', '大纲'], ['info', '信息']].map(([k, label]) => (
          <button type="button" key={k} class={`pn-tab${tab === k ? ' is-active' : ''}`} onClick={() => shell.setUI({ panelTab: k })}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" class="icon-btn" style={{ marginBottom: '8px' }} title="收起面板" onClick={() => shell.setUI({ panel: false })}><Icon name="x" size={15} /></button>
      </div>
      <div class="pn-body">
        {!found && <div class="hint" style={{ paddingTop: '16px' }}>打开一篇文档后，这里可以设置链接、封面、标签和排版。</div>}
        {found && tab === 'page' && <PagePanel key={st.currentId} shell={shell} st={st} found={found} />}
        {found && tab === 'outline' && <OutlinePanel shell={shell} st={st} />}
        {found && tab === 'info' && <InfoPanel shell={shell} st={st} found={found} />}
      </div>
    </aside>
  );
}

function update(shell, id, patch) {
  shell.data.updateMeta(id, patch);
  shell.pushMeta(id);
  shell.store.set({ savedAt: Date.now() });
}

function SlugField({ shell, found }) {
  const id = found.meta.id;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(found.meta.slug);
  const published = !!shell.data.pubOf(id);
  if (found.kind === 'about') {
    return <div class="field"><label>网址</label><div class="slug-view">/about/</div></div>;
  }
  const prefix = found.kind === 'galleryItem' ? `/gallery/${found.cat.slug}/` : SLUG_PREFIX[found.kind];
  const livePath = shell.data.pageUrl(id);
  const draftPath = '/' + shell.data.draftPath(id);
  const moved = published && livePath && decodeURI(livePath) !== draftPath;
  const commit = () => {
    const s = cleanSlug(value);
    if (s && s !== found.meta.slug) update(shell, id, { slug: s });
    setEditing(false);
  };
  return (
    <div class="field">
      <label>网址 {!found.meta.slugLocked && <span class="muted">· 跟随标题自动生成</span>}</label>
      {editing ? (
        <>
          <div class="slug-box">
            <span>{prefix}</span>
            <input class="input is-mono" value={value} autoFocus onInput={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setValue(found.meta.slug); setEditing(false); } }}
              onBlur={commit} />
            <span style={{ paddingRight: '10px' }}>.html</span>
          </div>
          {published && <div class="hint">改了以后，旧网址会自动跳转到新网址。</div>}
        </>
      ) : (
        <div class="field-row">
          <div class="slug-view" style={{ flex: 1 }}>{draftPath}</div>
          <button type="button" class="icon-btn" title="修改网址" onClick={() => { setValue(found.meta.slug); setEditing(true); }}><Icon name="text" size={14} /></button>
          {published && <button type="button" class="icon-btn" title="打开线上页面" onClick={() => window.open(shell.liveUrl(id), '_blank', 'noopener')}><Icon name="external" size={14} /></button>}
        </div>
      )}
      {moved && !editing && <div class="hint">发布后网址会从 {decodeURI(livePath)} 改成上面的新网址，旧网址自动跳转。</div>}
    </div>
  );
}

function TagsField({ shell, found }) {
  const id = found.meta.id;
  const tags = found.meta.tags || [];
  const [text, setText] = useState('');
  const all = shell.data.suggestions(found.kind === 'work' ? 'work' : 'post').tags.filter(t => !tags.includes(t)).slice(0, 8);
  const add = raw => {
    const parts = String(raw).split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    const next = [...tags];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    if (next.length !== tags.length) update(shell, id, { tags: next });
    setText('');
  };
  return (
    <div class="field">
      <label>标签</label>
      <div class="chips" onClick={e => { const i = e.currentTarget.querySelector('input'); if (i) i.focus(); }}>
        {tags.map(t => (
          <span class="chip" key={t}>{t}<button type="button" title="移除" onClick={() => update(shell, id, { tags: tags.filter(x => x !== t) })}><Icon name="x" size={11} /></button></span>
        ))}
        <input value={text} placeholder={tags.length ? '' : '输入后回车'} onInput={e => setText(e.target.value)}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ',' || e.key === '，') && !e.isComposing) { e.preventDefault(); if (text.trim()) add(text); }
            if (e.key === 'Backspace' && !text && tags.length) update(shell, id, { tags: tags.slice(0, -1) });
          }}
          onBlur={() => { if (text.trim()) add(text); }} />
      </div>
      {all.length > 0 && <div class="suggest-row">{all.map(t => <button type="button" key={t} onClick={() => add(t)}>+ {t}</button>)}</div>}
    </div>
  );
}

function ImageField({ shell, found, label, keys, purpose, hint }) {
  const id = found.meta.id;
  const [busy, setBusy] = useState(false);
  const src = found.meta[keys.src];
  const upload = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      setBusy(true);
      try {
        const r = await shell.images.process(file, purpose);
        const patch = { [keys.src]: r.src, [keys.pos]: '50% 50%' };
        if (keys.full) patch[keys.full] = r.full || r.src;
        update(shell, id, patch);
      } catch (err) {
        shell.toast('图片处理失败：' + (err.message || err), 'error');
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };
  const library = async () => {
    const picked = await shell.pickImage({ multiple: false });
    if (picked && picked[0]) {
      const patch = { [keys.src]: picked[0].src, [keys.pos]: '50% 50%' };
      if (keys.full) patch[keys.full] = picked[0].src;
      update(shell, id, patch);
    }
  };
  const remove = () => {
    const patch = { [keys.src]: '', [keys.pos]: '50% 50%' };
    if (keys.full) patch[keys.full] = '';
    update(shell, id, patch);
  };
  return (
    <div class="field">
      <label>{label}</label>
      <div class="img-field">
        <div class="img-thumb">{src ? <img src={shell.images.displaySrc(src)} alt="" style={{ objectPosition: found.meta[keys.pos] || '50% 50%' }} /> : <Icon name="image" size={18} />}</div>
        <div class="img-actions">
          <button type="button" class="btn is-small" disabled={busy} onClick={upload}>{busy ? <span class="spinner" /> : <Icon name="upload" size={13} />}{src ? '更换' : '上传'}</button>
          <button type="button" class="btn is-small" onClick={library}><Icon name="gallery" size={13} />图片库</button>
          {src && <button type="button" class="btn is-small" onClick={() => shell.api && shell.api.exec('openField', 'focus')} title="图片被裁切时保留哪一块"><Icon name="focus" size={13} />焦点</button>}
          {src && <button type="button" class="btn is-small is-danger" onClick={remove}><Icon name="trash" size={13} /></button>}
        </div>
      </div>
      {hint && <div class="hint">{hint}</div>}
    </div>
  );
}

function CardPreview({ shell, found }) {
  const ref = useRef(null);
  const boxRef = useRef(null);
  const [height, setHeight] = useState(300);
  const [boxW, setBoxW] = useState(268);
  const img = src => (src ? shell.images.displaySrc(src) : src);
  let card = '';
  let grid = '';
  if (found.kind === 'post') { card = blogCardHTML({ ...found.meta, cover: img(found.meta.cover) }); grid = 'blog-grid'; }
  else if (found.kind === 'work') { card = workCardHTML({ ...found.meta, cover: img(found.meta.cover) }); grid = 'works-grid'; }
  else if (found.kind === 'galleryItem') { card = galleryItemCardHTML(found.cat, { ...found.meta, img: img(found.meta.img), imgFull: '' }); grid = 'gallery-grid'; }
  const cardW = found.kind === 'galleryItem' ? 260 : 340;
  const frameW = cardW + 24;
  const scale = Math.min(1, boxW / frameW);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS_HREF}"><style>${SITE_CSS}</style>
<style>html,body{background:#0a0a0f;overflow:hidden}body{padding:12px}.${grid}{grid-template-columns:${cardW}px;margin:0}a{pointer-events:none}</style></head>
<body class="page-list"><div class="${grid}">${card}</div></body></html>`;
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    const measure = () => {
      try { setHeight(Math.min(600, f.contentDocument.body.scrollHeight)); } catch { /* ignore */ }
    };
    f.onload = () => { measure(); setTimeout(measure, 500); };
  }, [html]);
  useEffect(() => {
    if (boxRef.current) setBoxW(boxRef.current.clientWidth);
  }, []);
  if (!card) return null;
  return (
    <div class="pn-sec">
      <div class="pn-sec-title">列表卡片预览<span class="pn-aside muted">{found.kind === 'post' ? '博客页' : found.kind === 'work' ? '项目页' : '分类页'}</span></div>
      <div class="card-preview" ref={boxRef} style={{ height: Math.round(height * scale) + 'px' }}>
        <iframe ref={ref} srcDoc={html} title="卡片预览" tabIndex={-1}
          style={{ width: frameW + 'px', height: height + 'px', transform: `scale(${scale})`, transformOrigin: '0 0' }} />
      </div>
    </div>
  );
}

const SLIDERS = [
  { key: 'width', label: '正文宽度', step: 10, unit: 'px' },
  { key: 'fs', label: '字号', step: 1, unit: 'px' },
  { key: 'lh', label: '行高', step: 0.05, unit: '' },
  { key: 'pgap', label: '段落间距', step: 1, unit: 'px' },
  { key: 'codeFs', label: '代码字号', step: 1, unit: 'px' },
];

function LayoutSection({ shell, found }) {
  const id = found.meta.id;
  const layout = normLayout(found.meta.layout, found.kind);
  const defaults = LAYOUT_DEFAULTS[found.kind] || LAYOUT_DEFAULTS.post;
  const isDefault = JSON.stringify(layout) === JSON.stringify(normLayout(defaults, found.kind));
  const set = patch => update(shell, id, { layout: { ...layout, ...patch } });
  return (
    <div class="pn-sec">
      <div class="pn-sec-title">排版<span class="pn-aside">{!isDefault && <button type="button" class="btn is-small is-ghost" onClick={() => update(shell, id, { layout: defaults })}>恢复默认</button>}</span></div>
      {SLIDERS.map(s => (
        <div class="slider" key={s.key}>
          <label>{s.label}</label>
          <input type="range" min={LAYOUT_LIMITS[s.key][0]} max={LAYOUT_LIMITS[s.key][1]} step={s.step} value={layout[s.key]}
            onInput={e => set({ [s.key]: parseFloat(e.target.value) })} />
          <span class="num">{s.key === 'lh' ? layout[s.key].toFixed(2) : layout[s.key]}{s.unit}</span>
        </div>
      ))}
      <label class="switch"><span class="muted" style={{ fontSize: '12px' }}>段落首行缩进两字</span><input type="checkbox" checked={layout.indent} onChange={e => set({ indent: e.target.checked })} /></label>
    </div>
  );
}

function PagePanel({ shell, st, found }) {
  const id = found.meta.id;
  const m = found.meta;
  const published = !!shell.data.pubOf(id);
  const cats = shell.data.suggestions('post').cats;
  return (
    <>
      <div class="pn-sec">
        <SlugField shell={shell} found={found} />
      </div>
      {found.kind === 'post' && (
        <div class="pn-sec">
          <div class="field">
            <label>分类</label>
            <input class="input" list="dl-cats" value={m.cat || ''} placeholder="未分类" onChange={e => update(shell, id, { cat: e.target.value.trim() })} />
            <datalist id="dl-cats">{cats.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div class="field">
            <label>日期</label>
            <input class="input" type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(m.date || '') ? m.date : ''} onChange={e => update(shell, id, { date: e.target.value })} />
          </div>
          <TagsField shell={shell} found={found} />
          <ImageField shell={shell} found={found} label="封面" keys={{ src: 'cover', pos: 'coverPos' }} purpose="cover" hint="显示在文章顶部和博客列表卡片上。" />
        </div>
      )}
      {found.kind === 'work' && (
        <div class="pn-sec">
          <div class="field">
            <label>一句话简介 <span class="muted">· 显示在项目卡片上</span></label>
            <textarea class="textarea" rows={2} value={m.desc || ''} onChange={e => update(shell, id, { desc: e.target.value })} />
          </div>
          <TagsField shell={shell} found={found} />
          <ImageField shell={shell} found={found} label="封面" keys={{ src: 'cover', pos: 'coverPos', full: 'coverFull' }} purpose="cover" />
          <div class="field">
            <label>在线游玩地址</label>
            <input class="input is-mono" value={m.play || ''} placeholder="https://…（itch.io / 网页游戏）" onChange={e => update(shell, id, { play: e.target.value.trim() })} />
          </div>
          <div class="field">
            <label>项目链接</label>
            <input class="input is-mono" value={m.link || ''} placeholder="https://…" onChange={e => update(shell, id, { link: e.target.value.trim() })} />
          </div>
        </div>
      )}
      {found.kind === 'galleryItem' && (
        <div class="pn-sec">
          <div class="field">
            <label>分类</label>
            <select class="select" value={found.cat.id} onChange={e => { shell.data.moveGalleryItem(id, e.target.value); shell.pushMeta(id); }}>
              {shell.data.ws.gallery.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div class="field">
            <label>简介 <span class="muted">· 显示在分类页卡片上</span></label>
            <textarea class="textarea" rows={2} value={m.desc || ''} onChange={e => update(shell, id, { desc: e.target.value })} />
          </div>
          <ImageField shell={shell} found={found} label="作品图片" keys={{ src: 'img', pos: 'imgPos', full: 'imgFull' }} purpose="gallery" hint="会自动生成缩略图，原图用于大图查看。" />
        </div>
      )}
      {found.kind !== 'about' && <CardPreview shell={shell} found={found} />}
      <LayoutSection shell={shell} found={found} />
      {found.kind !== 'about' && (
        <div class="pn-sec">
          <div class="pn-sec-title">管理</div>
          <div class="field-row" style={{ flexWrap: 'wrap' }}>
            <button type="button" class="btn is-small" onClick={() => shell.duplicateDoc(id)}><Icon name="duplicate" size={13} />创建副本</button>
            {published && <button type="button" class="btn is-small" onClick={() => shell.unpublishDoc(id)}><Icon name="cloudOff" size={13} />从网站撤下</button>}
            <button type="button" class="btn is-small is-danger" onClick={() => shell.trashDoc(id)}><Icon name="trash" size={13} />移到回收站</button>
          </div>
        </div>
      )}
    </>
  );
}

function OutlinePanel({ shell, st }) {
  const stats = st.stats[st.currentId];
  const heads = (stats && stats.headings) || [];
  if (!heads.length) return <div class="hint" style={{ paddingTop: '16px' }}>正文里还没有标题。输入“/”选择标题，或在行首输入 # 加空格。</div>;
  return (
    <div class="outline-list" style={{ paddingTop: '10px' }}>
      {heads.map((h, i) => (
        <button type="button" key={i} class={`outline-item l${h.level}`} title={h.text} onClick={() => shell.api && shell.api.scrollToHeading(i)}>{h.text || '（空标题）'}</button>
      ))}
    </div>
  );
}

function InfoPanel({ shell, st, found }) {
  const id = found.meta.id;
  const stats = st.stats[id] || {};
  const status = shell.data.status(id);
  const p = shell.data.pubOf(id);
  const minutes = stats.chars ? Math.max(1, Math.round(stats.chars / 400)) : 0;
  return (
    <>
      <div class="pn-sec">
        <div class="stat-row">
          <div class="stat"><b>{stats.words || 0}</b><span>字数</span></div>
          <div class="stat"><b>{minutes}</b><span>分钟读完</span></div>
        </div>
      </div>
      <div class="pn-sec">
        <dl class="info-grid">
          <dt>状态</dt><dd>{STATUS_TEXT[status]}</dd>
          <dt>最近发布</dt><dd>{p && p.meta.publishedAt ? relTime(Date.parse(p.meta.publishedAt)) : '—'}</dd>
          <dt>本机修改</dt><dd>{found.meta.updatedAt ? relTime(found.meta.updatedAt) : '—'}</dd>
          <dt>创建于</dt><dd>{found.meta.createdAt ? new Date(found.meta.createdAt).toLocaleString('zh-CN') : '—'}</dd>
          <dt>线上地址</dt><dd>{p ? <a href={shell.liveUrl(id)} target="_blank" rel="noopener">{decodeURI(shell.data.pageUrl(id))}</a> : '未发布'}</dd>
          <dt>字符</dt><dd>{stats.chars || 0}</dd>
        </dl>
      </div>
      <div class="pn-sec">
        <div class="field-row" style={{ flexWrap: 'wrap' }}>
          <button type="button" class="btn is-small" onClick={() => shell.openDialog({ type: 'history', docId: id })}><Icon name="history" size={13} />历史版本</button>
          <button type="button" class="btn is-small" onClick={() => shell.openDialog({ type: 'preview' })}><Icon name="eye" size={13} />预览</button>
        </div>
        <div class="hint" style={{ marginTop: '10px' }}>草稿自动保存在这台电脑的浏览器里。换电脑编辑前请先发布，或在设置里导出备份。</div>
      </div>
    </>
  );
}
