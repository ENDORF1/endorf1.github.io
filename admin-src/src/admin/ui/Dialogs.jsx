import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Dialog, Icon, relTime, download, pickFile, MOD } from './common.jsx';
import { DEVICES } from './TopBar.jsx';
import { KIND_LABEL } from '../data.js';
import { SITE_CSS } from '../assets.js';
import { renderPage } from '../../shared/site.js';
import { changePassword } from '../crypto.js';
import { importLegacy, readLegacy } from '../legacy.js';

export function DialogHost({ shell, st }) {
  const d = st.dialog;
  if (!d) return null;
  const close = () => shell.closeDialog();
  switch (d.type) {
    case 'confirm': return <ConfirmDialog shell={shell} d={d} />;
    case 'prompt': return <PromptDialog shell={shell} d={d} />;
    case 'publish': return <PublishDialog shell={shell} st={st} onClose={close} />;
    case 'preview': return <PreviewDialog shell={shell} st={st} onClose={close} />;
    case 'history': return <HistoryDialog shell={shell} st={st} d={d} onClose={close} />;
    case 'library': return <LibraryDialog shell={shell} d={d} onClose={close} />;
    case 'settings': return <SettingsDialog shell={shell} st={st} d={d} onClose={close} />;
    case 'trash': return <TrashDialog shell={shell} st={st} onClose={close} />;
    case 'help': return <HelpDialog onClose={close} />;
    default: return null;
  }
}

/* ---------------- confirm / prompt ---------------- */

function ConfirmDialog({ shell, d }) {
  return (
    <Dialog title={d.title} onClose={() => shell.answer(false)}
      footer={<>
        <button type="button" class="btn" onClick={() => shell.answer(false)}>取消</button>
        <button type="button" class={`btn ${d.danger ? 'is-danger is-solid' : 'is-primary'}`} autofocus onClick={() => shell.answer(true)}>{d.ok}</button>
      </>}>
      <div class="dlg-body"><p style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>{d.text}</p></div>
    </Dialog>
  );
}

function PromptDialog({ shell, d }) {
  const fields = d.fields || [{ name: 'value', label: d.label, value: d.value }];
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(f => [f.name, f.value || ''])));
  const submit = e => {
    e.preventDefault();
    shell.answer(d.fields ? values : values.value.trim());
  };
  return (
    <Dialog title={d.title} onClose={() => shell.answer(null)}>
      <form onSubmit={submit}>
        <div class="dlg-body">
          {fields.map((f, i) => (
            <div class="field" key={f.name}>
              <label>{f.label}</label>
              <input class={`input${f.mono ? ' is-mono' : ''}`} autofocus={i === 0} value={values[f.name]} placeholder={f.placeholder || ''}
                onInput={e => setValues({ ...values, [f.name]: e.target.value })} />
            </div>
          ))}
        </div>
        <div class="dlg-foot">
          <button type="button" class="btn" onClick={() => shell.answer(null)}>取消</button>
          <button type="submit" class="btn is-primary">{d.ok || '确定'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/* ---------------- publish all ---------------- */

function PublishDialog({ shell, st, onClose }) {
  const data = shell.data;
  const changes = useMemo(() => data.pendingChanges(), [st.rev]);
  const [picked, setPicked] = useState(() => new Set([...changes.docs.map(d => d.id), ...changes.takedowns.map(t => t.id)]));
  const [done, setDone] = useState(null);
  const toggle = id => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };
  const run = async () => {
    const ids = changes.docs.filter(d => picked.has(d.id)).map(d => d.id);
    const unpublishIds = changes.takedowns.filter(t => picked.has(t.id)).map(t => t.id);
    const res = await shell.publish({ ids, unpublishIds, label: '发布更改' });
    if (res) setDone({ count: ids.length + unpublishIds.length, noop: res.noop });
  };
  const total = picked.size;
  const publishing = st.publishing;
  const kindText = d => (d.kind === 'galleryItem' ? `画廊 · ${(d.cat && d.cat.name) || ''}` : KIND_LABEL[d.kind]);
  return (
    <Dialog title="发布更改" onClose={onClose}
      footer={done ? <>
        <span class="hint">{done.noop ? '线上已是最新。' : `已提交 ${done.count} 项更改，网站通常在 1 分钟内更新。`}</span>
        <button type="button" class="btn is-primary" onClick={onClose}>完成</button>
      </> : <>
        <span class="hint">一次提交全部所选内容，列表页和首页会一起更新。</span>
        <button type="button" class="btn" onClick={onClose} disabled={!!publishing}>取消</button>
        <button type="button" class="btn is-primary" disabled={!!publishing || (!total && !changes.structure.length)} onClick={run}>
          {publishing ? <><span class="spinner" />发布中…</> : <><Icon name="send" size={14} />{total ? `发布 ${total} 项` : '更新列表页'}</>}
        </button>
      </>}>
      <div class="dlg-body">
        {publishing ? (
          <div class="progress-log">{publishing.progress.map((l, i) => <div key={i}>{l}</div>)}</div>
        ) : done ? (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', color: 'var(--green)' }}><Icon name="check" size={18} />发布成功</div>
        ) : (
          <>
            {!changes.docs.length && !changes.takedowns.length && !changes.structure.length && <p class="muted">所有内容都已是线上最新版本。</p>}
            {changes.docs.length > 0 && (
              <div class="change-list">
                {changes.docs.map(d => (
                  <label class="change-row" key={d.id}>
                    <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} />
                    <span class={d.status === 'new' ? 'tag-new' : 'tag-mod'}>{d.status === 'new' ? '新发布' : '更新'}</span>
                    <span class="ch-title">{d.meta.title || '无标题'}</span>
                    <span class="ch-kind">{kindText(d)}</span>
                  </label>
                ))}
              </div>
            )}
            {changes.takedowns.length > 0 && (
              <div class="change-list" style={{ marginTop: '8px' }}>
                {changes.takedowns.map(t => (
                  <label class="change-row" key={t.id}>
                    <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
                    <span class="tag-del">撤下</span>
                    <span class="ch-title">{t.meta.title || '无标题'}</span>
                    <span class="ch-kind">已在回收站</span>
                  </label>
                ))}
              </div>
            )}
            {changes.structure.length > 0 && <p class="hint" style={{ marginTop: '12px' }}>另外会更新：{changes.structure.join('、')}。</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}

/* ---------------- preview + WYSIWYG check ---------------- */

function measureFrame(frame) {
  const doc = frame.contentDocument;
  const body = doc && doc.querySelector('.post-body, .wd-body, .gd-body, .about-body');
  if (!body) return null;
  const base = body.getBoundingClientRect();
  const win = frame.contentWindow;
  return {
    viewport: { width: win.innerWidth, height: win.innerHeight },
    doc: { top: Math.round(base.top + win.scrollY), left: Math.round(base.left), width: Math.round(base.width), height: Math.round(base.height) },
    blocks: [...body.children].map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, top: Math.round(r.top - base.top), height: Math.round(r.height), left: Math.round(r.left - base.left), width: Math.round(r.width) };
    }),
  };
}

async function settle(frame) {
  const doc = frame.contentDocument;
  if (!doc) return;
  try { await doc.fonts.ready; } catch { /* ignore */ }
  const imgs = [...doc.images];
  // Lazy images below the fold never load on their own here, and until they do their box uses the width/height attributes.
  for (const img of imgs) img.loading = 'eager';
  await Promise.all(imgs.map(img => (img.complete ? null : new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 8000); }))));
  await new Promise(r => setTimeout(r, 120));
}

function compare(a, b) {
  const issues = [];
  if (!a || !b) return ['无法读取排版信息'];
  if (a.viewport.width !== b.viewport.width) issues.push(`视口宽度不同（编辑器 ${a.viewport.width}px，预览 ${b.viewport.width}px）`);
  if (Math.abs(a.doc.top - b.doc.top) > 1) issues.push(`正文起始位置差 ${b.doc.top - a.doc.top}px（页头区域高度不同）`);
  if (Math.abs(a.doc.width - b.doc.width) > 1) issues.push(`正文宽度差 ${b.doc.width - a.doc.width}px`);
  if (a.blocks.length !== b.blocks.length) issues.push(`块数量不同（编辑器 ${a.blocks.length}，发布 ${b.blocks.length}）`);
  const n = Math.min(a.blocks.length, b.blocks.length);
  let listed = 0;
  for (let i = 0; i < n && listed < 8; i++) {
    const x = a.blocks[i];
    const y = b.blocks[i];
    const d = ['top', 'height', 'left', 'width'].filter(k => Math.abs(x[k] - y[k]) > 1);
    if (d.length) {
      issues.push(`第 ${i + 1} 个块（${x.tag.toLowerCase()}）${d.map(k => `${{ top: '位置', height: '高度', left: '左边距', width: '宽度' }[k]}差 ${y[k] - x[k]}px`).join('，')}`);
      listed++;
    }
  }
  return issues;
}

function PreviewDialog({ shell, st, onClose }) {
  const id = st.currentId;
  const found = id ? shell.data.find(id) : null;
  const [device, setDevice] = useState('match');
  const [html, setHtml] = useState(null);
  const [check, setCheck] = useState(null);
  const frameRef = useRef(null);
  const stageRef = useRef(null);
  const [stageW, setStageW] = useState(0);
  const editorFrame = shell.canvas && shell.canvas.iframe;
  const editorWidth = editorFrame ? parseInt(editorFrame.style.width, 10) || editorFrame.clientWidth : 1200;
  const editorHeight = editorFrame ? parseInt(editorFrame.style.height, 10) || editorFrame.clientHeight : 800;

  useEffect(() => {
    if (!found) return;
    (async () => {
      const body = (shell.api && shell.api.getJSON()) || (await shell.data.getBody(id));
      const cat = found.cat ? { id: found.cat.id, slug: found.cat.slug, name: found.cat.name } : null;
      let page = renderPage(found.kind, shell.data.fullMeta(found), body, { css: SITE_CSS, doc: document, cat, mode: 'publish' });
      for (const m of shell.images.list()) {
        const url = shell.images.urlFor(m.path);
        const local = shell.images.displaySrc(url);
        if (local !== url) page = page.split(url).join(local);
      }
      page = page.replace('</head>', '<base target="_blank"></head>');
      setHtml(page);
    })();
  }, [id]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.observe(el);
    setStageW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const devices = [{ id: 'match', label: '同编辑器', width: editorWidth }, ...DEVICES.filter(d => d.width)];
  const dev = devices.find(d => d.id === device) || devices[0];
  const scale = Math.min(1, (stageW - 24) / dev.width);

  const runCheck = async () => {
    setDevice('match');
    setCheck({ state: 'running' });
    await new Promise(r => setTimeout(r, 60));
    const frame = frameRef.current;
    await Promise.all([settle(frame), settle(shell.canvas.iframe)]);
    const a = shell.api.measure();
    const b = measureFrame(frame);
    const issues = compare(a, b);
    setCheck({ state: issues.length ? 'bad' : 'ok', issues, blocks: b ? b.blocks.length : 0 });
  };

  if (!found) return null;
  return (
    <Dialog title={`预览：${found.meta.title || '无标题'}`} size="is-full" onClose={onClose}
      headExtra={<>
        <div class="seg">
          {devices.map(d => (
            <button type="button" key={d.id} class={device === d.id ? 'is-active' : ''} onClick={() => setDevice(d.id)}>{d.label}{d.width ? ` ${d.width}` : ''}</button>
          ))}
        </div>
        <button type="button" class="btn is-small" onClick={runCheck} title="逐块比较编辑器和发布页面的位置与尺寸">
          {check && check.state === 'running' ? <span class="spinner" /> : <Icon name="check" size={13} />}排版一致性检查
        </button>
      </>}>
      <div class="preview-stage" ref={stageRef}>
        <div style={{ width: dev.width * scale + 'px', height: '100%', flex: 'none', position: 'relative' }}>
          {html && <iframe ref={frameRef} class="preview-frame" srcDoc={html} title="发布预览"
            style={{ width: dev.width + 'px', height: device === 'match' ? editorHeight + 'px' : `${100 / scale}%`, transform: scale < 1 ? `scale(${scale})` : '', transformOrigin: '0 0', position: 'absolute', left: 0, top: 0 }} />}
        </div>
      </div>
      {check && check.state !== 'running' && (
        <div class={`check-result ${check.state === 'ok' ? 'is-ok' : 'is-bad'}`}>
          <Icon name={check.state === 'ok' ? 'check' : 'alert'} size={16} />
          <div>
            {check.state === 'ok'
              ? `一致：正文 ${check.blocks} 个块在编辑器和发布页面中的位置、尺寸完全相同（误差 ≤ 1px）。`
              : <>发现差异：<ul>{check.issues.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ---------------- history ---------------- */

const REASON = {
  open: '打开时', auto: '自动保存', publish: '发布前', 'before-restore': '恢复前', 'before-discard': '放弃修改前',
  'before-import': '导入备份前', 'before-legacy': '导入旧后台草稿前',
};

function HistoryDialog({ shell, st, d, onClose }) {
  const id = d.docId || st.currentId;
  const found = shell.data.find(id);
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  useEffect(() => {
    shell.flushAll();
    shell.data.history(id).then(l => { setList(l); setSel(l[0] || null); });
  }, [id]);
  const html = useMemo(() => {
    if (!sel || !found) return '';
    const cat = found.cat ? { id: found.cat.id, slug: found.cat.slug, name: found.cat.name } : null;
    let page = renderPage(found.kind, { ...sel.meta, catId: cat && cat.id }, sel.body, { css: SITE_CSS, doc: document, cat, mode: 'publish' });
    return page.replace('</head>', '<base target="_blank"></head>');
  }, [sel]);
  const restore = async () => {
    const ok = await shell.confirm({ title: '恢复到这个版本？', text: '当前内容会先存进历史版本，恢复后仍可找回。', ok: '恢复' });
    if (!ok) { shell.openDialog({ type: 'history', docId: id }); return; }
    await shell.data.restore(id, sel);
    shell.openDoc(id, { force: true });
    shell.toast('已恢复', 'success');
  };
  return (
    <Dialog title={`历史版本：${(found && found.meta.title) || '无标题'}`} size="is-wide" onClose={onClose}
      footer={<>
        <span class="hint">历史版本保存在本机，每篇保留最近 60 个。</span>
        <button type="button" class="btn" onClick={onClose}>关闭</button>
        <button type="button" class="btn is-primary" disabled={!sel} onClick={restore}>恢复此版本</button>
      </>}>
      <div class="history">
        <div class="history-list">
          {list && !list.length && <div class="hint" style={{ padding: '8px' }}>还没有历史版本。编辑时会每 5 分钟自动保存一次。</div>}
          {list && list.map(s => (
            <button type="button" key={s.key} class={`history-item${sel && sel.key === s.key ? ' is-active' : ''}`} onClick={() => setSel(s)}>
              <b>{relTime(s.ts)}</b>
              <span>{REASON[s.reason] || s.reason} · {s.title || '无标题'}</span>
            </button>
          ))}
        </div>
        <div class="history-view">{sel && <iframe srcDoc={html} title="历史版本预览" />}</div>
      </div>
    </Dialog>
  );
}

/* ---------------- image library ---------------- */

function LibraryDialog({ shell, d, onClose }) {
  const [remote, setRemote] = useState(null);
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  useEffect(() => {
    if (!shell.gh.ready) { setRemote([]); return; }
    (async () => {
      try {
        const head = await shell.gh.head();
        const tree = await shell.gh.tree(head.tree);
        const paths = [...tree.keys()].filter(p => /^images\/.+\.(webp|png|jpe?g|gif|svg|avif)$/i.test(p)).sort().reverse();
        setRemote(paths);
      } catch (err) {
        setRemote([]);
        shell.toast('读取仓库图片失败：' + (err.message || err), 'error');
      }
    })();
  }, []);
  const local = shell.images.list();
  const localPaths = new Set(local.map(m => m.path));
  const items = [
    ...local.map(m => ({ path: m.path, pending: m.pending, src: shell.images.urlFor(m.path), thumb: shell.images.displaySrc(shell.images.urlFor(m.path)) })),
    ...(remote || []).filter(p => !localPaths.has(p)).map(p => ({ path: p, pending: false, src: shell.images.urlFor(p), thumb: shell.images.urlFor(p) })),
  ].filter(it => !filter || it.path.toLowerCase().includes(filter.toLowerCase()));
  const pick = d.pick;
  const toggle = it => {
    if (!pick) {
      navigator.clipboard.writeText(it.src).then(() => shell.toast('图片链接已复制', 'success'));
      return;
    }
    if (!d.multiple) { setSelected([it]); return; }
    setSelected(selected.some(s => s.path === it.path) ? selected.filter(s => s.path !== it.path) : [...selected, it]);
  };
  const upload = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      setBusy(true);
      try {
        for (const f of input.files) await shell.images.process(f, 'body');
        force(n => n + 1);
      } catch (err) {
        shell.toast('图片处理失败：' + (err.message || err), 'error');
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };
  const confirm = (list = selected) => {
    const result = list.map(s => ({ src: s.src }));
    shell.store.set({ dialog: null });
    shell.resolvePick(result);
  };
  return (
    <Dialog title={pick ? '选择图片' : '图片库'} size="is-wide" onClose={onClose}
      footer={pick ? <>
        <span class="hint">{selected.length ? `已选 ${selected.length} 张` : '点击图片选择'}</span>
        <button type="button" class="btn" onClick={onClose}>取消</button>
        <button type="button" class="btn is-primary" disabled={!selected.length} onClick={() => confirm()}>插入</button>
      </> : <span class="hint">点击图片复制链接。标着“待上传”的图片会在引用它的文档发布时一起上传。</span>}>
      <div class="dlg-body">
        <div class="lib-toolbar">
          <input class="input" style={{ maxWidth: '260px' }} placeholder="按文件名筛选" value={filter} onInput={e => setFilter(e.target.value)} />
          <button type="button" class="btn" disabled={busy} onClick={upload}>{busy ? <span class="spinner" /> : <Icon name="upload" size={14} />}上传图片</button>
          {remote === null && <span class="muted" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><span class="spinner" />正在读取仓库里的图片…</span>}
        </div>
        {!items.length && remote !== null && <div class="hint">没有图片。</div>}
        <div class="lib-grid">
          {items.map(it => {
            const isSel = selected.some(s => s.path === it.path);
            return (
              <div key={it.path} class={`lib-item${isSel ? ' is-selected' : ''}`} title={it.path} onClick={() => toggle(it)} onDblClick={() => { if (pick) confirm([it]); }}>
                <img src={it.thumb} alt="" loading="lazy" decoding="async" />
                {it.pending && <span class="lib-badge">待上传</span>}
                {isSel && <span class="lib-check"><Icon name="check" size={13} /></span>}
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------- trash ---------------- */

function TrashDialog({ shell, st, onClose }) {
  const trash = shell.data.ws.trash;
  return (
    <Dialog title="回收站" onClose={onClose} footer={<span class="hint">未发布的文档 30 天后自动清除。已发布的会一直保留，直到你发布撤下它。</span>}>
      <div class="dlg-body">
        {!trash.length && <p class="muted">回收站是空的。</p>}
        <div class="change-list">
          {trash.map(t => {
            const published = !!shell.data.pubOf(t.id);
            return (
              <div class="change-row" key={t.id} style={{ cursor: 'default' }}>
                {published ? <span class="tag-del">仍在线</span> : <span class="tag-new" style={{ opacity: .6 }}>草稿</span>}
                <span class="ch-title">{t.meta.title || '无标题'}</span>
                <span class="ch-kind">{KIND_LABEL[t.kind]} · {relTime(t.deletedAt)}</span>
                <button type="button" class="btn is-small" onClick={() => { shell.data.restoreFromTrash(t.id); shell.openDoc(t.id); onClose(); }}>恢复</button>
                {published
                  ? <button type="button" class="btn is-small is-danger" onClick={() => shell.publish({ unpublishIds: [t.id], label: '撤下页面' })}>撤下</button>
                  : <button type="button" class="btn is-small is-danger" onClick={() => shell.data.deleteForever(t.id)}>彻底删除</button>}
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------- settings ---------------- */

function GitHubSettings({ shell }) {
  const [user, setUser] = useState(localStorage.getItem('gh_user') || '');
  const [repo, setRepo] = useState(localStorage.getItem('gh_repo') || '');
  const [token, setToken] = useState(shell.token || '');
  const [state, setState] = useState(null);
  const save = async () => {
    setState({ busy: true });
    try {
      await shell.saveGitHub({ user, repo, token });
      const info = await shell.testGitHub();
      setState({ ok: `已连接 ${info.full_name}，可以发布` });
      shell.sync({ quiet: true });
    } catch (err) {
      setState({ err: err.message || String(err) });
    }
  };
  return (
    <>
      <h4>GitHub 连接</h4>
      <div class="hint">发布就是把页面提交到 GitHub 仓库，GitHub Pages 会自动更新网站。令牌只保存在这台电脑，用你的后台密码加密。</div>
      <div class="field"><label>用户名</label><input class="input is-mono" value={user} onInput={e => setUser(e.target.value)} placeholder="ENDORF1" /></div>
      <div class="field"><label>仓库名</label><input class="input is-mono" value={repo} onInput={e => setRepo(e.target.value)} placeholder="endorf1.github.io" /></div>
      <div class="field">
        <label>访问令牌（Fine-grained token，仓库 Contents 读写权限）</label>
        <input class="input is-mono" type="password" value={token} onInput={e => setToken(e.target.value)} placeholder="github_pat_…" autocomplete="off" />
        <div class="hint"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">在 GitHub 创建令牌</a>：Repository access 选这个仓库，Permissions 里把 Contents 设为 Read and write。</div>
      </div>
      <div class="field-row">
        <button type="button" class="btn is-primary" disabled={state && state.busy} onClick={save}>{state && state.busy ? <span class="spinner" /> : null}保存并测试连接</button>
        {state && state.ok && <span class="ok-text">{state.ok}</span>}
        {state && state.err && <span class="err-text">{state.err}</span>}
      </div>
    </>
  );
}

function PasswordSettings({ shell }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [c, setC] = useState('');
  const [state, setState] = useState(null);
  const submit = async e => {
    e.preventDefault();
    if (b.length < 6) { setState({ err: '新密码至少 6 位' }); return; }
    if (b !== c) { setState({ err: '两次输入的新密码不一致' }); return; }
    try {
      await changePassword(a, b);
      shell.password = b;
      setState({ ok: '密码已修改，首页的编辑入口也会使用新密码' });
      setA(''); setB(''); setC('');
    } catch (err) {
      setState({ err: err.message || String(err) });
    }
  };
  return (
    <form onSubmit={submit}>
      <h4>后台密码</h4>
      <div class="hint">进入后台和首页编辑模式时使用。GitHub 令牌会用新密码重新加密。</div>
      <div class="field"><label>当前密码</label><input class="input" type="password" value={a} onInput={e => setA(e.target.value)} autocomplete="current-password" /></div>
      <div class="field"><label>新密码</label><input class="input" type="password" value={b} onInput={e => setB(e.target.value)} autocomplete="new-password" /></div>
      <div class="field"><label>再输一次</label><input class="input" type="password" value={c} onInput={e => setC(e.target.value)} autocomplete="new-password" /></div>
      <div class="field-row">
        <button type="submit" class="btn is-primary">修改密码</button>
        {state && state.ok && <span class="ok-text">{state.ok}</span>}
        {state && state.err && <span class="err-text">{state.err}</span>}
      </div>
    </form>
  );
}

function BackupSettings({ shell }) {
  const [busy, setBusy] = useState(false);
  const exportAll = async () => {
    setBusy(true);
    try {
      const backup = await shell.data.exportAll();
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      download(`devlog-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`, JSON.stringify(backup));
    } catch (err) {
      shell.toast('导出失败：' + (err.message || err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const importAll = async () => {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const ok = await shell.confirm({ title: '用备份替换本机的全部草稿？', text: '每篇文档当前的内容会先存进历史版本。', ok: '导入备份', danger: true });
      if (!ok) { shell.openDialog({ type: 'settings', section: 'backup' }); return; }
      await shell.data.importAll(backup);
      const first = shell.data.allDocs()[0];
      if (first) shell.openDoc(first.id, { force: true });
      shell.toast('备份已导入', 'success');
    } catch (err) {
      shell.toast('导入失败：' + (err.message || err), 'error');
    }
  };
  return (
    <>
      <h4>备份</h4>
      <div class="hint">草稿只保存在这台电脑的浏览器里。换电脑或清理浏览器数据前，先导出一份备份（包含所有文档和草稿，不包含未上传的图片文件）。</div>
      <div class="field-row">
        <button type="button" class="btn" disabled={busy} onClick={exportAll}><Icon name="download" size={14} />导出备份</button>
        <button type="button" class="btn" onClick={importAll}><Icon name="upload" size={14} />从备份导入</button>
      </div>
    </>
  );
}

function MaintenanceSettings({ shell, st }) {
  return (
    <>
      <div class="settings-block">
        <h4>从线上同步</h4>
        <div class="hint">读取网站上最新发布的内容。本机没改过的文档会更新成线上版本，改过的会保留并提示。</div>
        <button type="button" class="btn" disabled={st.sync.state === 'syncing'} onClick={() => shell.sync({ force: true })}>
          {st.sync.state === 'syncing' ? <span class="spinner" /> : <Icon name="refresh" size={14} />}立即同步
        </button>
        {st.sync.error && <div class="err-text" style={{ marginTop: '8px' }}>{st.sync.error}</div>}
        {st.sync.at && !st.sync.error && <div class="hint" style={{ marginTop: '8px', marginBottom: 0 }}>上次同步：{relTime(st.sync.at)}</div>}
      </div>
      <div class="settings-block">
        <h4>重新生成全站页面</h4>
        <div class="hint">页面模板更新后使用：用线上内容重新生成每个已发布页面、列表页和首页区块。不会发布本机草稿。</div>
        <button type="button" class="btn" disabled={!!st.publishing} onClick={() => { shell.closeDialog(); shell.publish({ rebuildAll: true, label: '重新生成全站' }); }}><Icon name="refresh" size={14} />重新生成</button>
      </div>
      <div class="settings-block">
        <h4>存储</h4>
        <StorageInfo />
      </div>
    </>
  );
}

function StorageInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    (async () => {
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
      setInfo({ used: est ? est.usage : 0, quota: est ? est.quota : 0, persisted });
    })();
  }, []);
  if (!info) return null;
  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  return <div class="hint" style={{ marginBottom: 0 }}>本机已用 {mb(info.used)}{info.quota ? ` / 可用 ${mb(info.quota)}` : ''}。{info.persisted ? '浏览器已允许持久保存，不会被自动清理。' : '浏览器可能在空间不足时清理数据，记得定期导出备份。'}</div>;
}

function LegacySettings({ shell }) {
  const legacy = readLegacy();
  const [state, setState] = useState(null);
  const run = async () => {
    setState({ busy: true });
    try {
      const res = await importLegacy(shell);
      setState({ res });
    } catch (err) {
      setState({ err: err.message || String(err) });
    }
  };
  return (
    <>
      <h4>旧版后台</h4>
      <div class="hint">旧后台仍然可以打开：<a href="admin-legacy.html" target="_blank" rel="noopener">admin-legacy.html</a>。它的草稿保存在这台电脑的浏览器里，和新后台分开。它不认识新后台发布的内容，用它发布会覆盖新后台生成的页面，所以只用来找回旧草稿。</div>
      {legacy.total ? (
        <>
          <div class="hint">这台电脑的旧后台里有 {legacy.posts.length} 篇文章、{legacy.works.length} 个项目、{legacy.items} 件画廊作品{legacy.about ? '和“关于我”' : ''}。可以把和线上不一样的内容导入成新后台的草稿（导入前会存历史版本）。</div>
          <button type="button" class="btn" disabled={state && state.busy} onClick={run}>{state && state.busy ? <span class="spinner" /> : <Icon name="download" size={14} />}对比并导入旧后台草稿</button>
          {state && state.res && <div class="ok-text" style={{ marginTop: '10px' }}>完成：更新 {state.res.updated.length} 篇，新建 {state.res.created.length} 篇，{state.res.same} 篇和线上一致已跳过。</div>}
          {state && state.res && state.res.updated.concat(state.res.created).length > 0 && <div class="hint" style={{ marginTop: '6px' }}>{state.res.updated.concat(state.res.created).join('、')}</div>}
          {state && state.err && <div class="err-text" style={{ marginTop: '10px' }}>{state.err}</div>}
        </>
      ) : <div class="hint">这台电脑的旧后台里没有草稿。</div>}
    </>
  );
}

function SettingsDialog({ shell, st, d, onClose }) {
  const [section, setSection] = useState(d.section || 'github');
  const nav = [
    ['github', 'GitHub 连接', 'globe'],
    ['password', '密码', 'lock'],
    ['backup', '备份', 'download'],
    ['maintenance', '同步与维护', 'refresh'],
    ['legacy', '旧版后台', 'history'],
  ];
  return (
    <Dialog title="设置" size="is-wide" onClose={onClose}>
      <div class="settings" style={{ flex: 1, minHeight: 0 }}>
        <nav class="settings-nav">
          {nav.map(([k, label, icon]) => (
            <button type="button" key={k} class={section === k ? 'is-active' : ''} onClick={() => setSection(k)}><Icon name={icon} size={14} />{label}</button>
          ))}
        </nav>
        <div class="settings-body">
          {section === 'github' && <GitHubSettings shell={shell} />}
          {section === 'password' && <PasswordSettings shell={shell} />}
          {section === 'backup' && <BackupSettings shell={shell} />}
          {section === 'maintenance' && <MaintenanceSettings shell={shell} st={st} />}
          {section === 'legacy' && <LegacySettings shell={shell} />}
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------- help ---------------- */

function HelpDialog({ onClose }) {
  const K = ({ k }) => <span>{k.split(' ').map((x, i) => <span key={i} class="kbd" style={{ marginLeft: '4px' }}>{x}</span>)}</span>;
  const rows = [
    ['常用', [
      ['插入菜单', '/'], ['保存（自动保存）', `${MOD} S`], ['预览发布效果', `${MOD} Shift P`], ['搜索文档', `${MOD} P`],
      ['查找', `${MOD} F`], ['替换', `${MOD} H`], ['收起侧边栏', `${MOD} \\`], ['快捷键', `${MOD} /`],
    ]],
    ['文字', [
      ['加粗', `${MOD} B`], ['斜体', `${MOD} I`], ['下划线', `${MOD} U`], ['删除线', `${MOD} Shift S`],
      ['行内代码', `${MOD} E`], ['链接', `${MOD} K`], ['撤销', `${MOD} Z`], ['重做', `${MOD} Shift Z`],
    ]],
    ['块', [
      ['正文', `${MOD} Alt 0`], ['一至四级标题', `${MOD} Alt 1-4`], ['有序列表', `${MOD} Shift 7`], ['无序列表', `${MOD} Shift 8`],
      ['任务列表', `${MOD} Shift 9`], ['复制当前块', `${MOD} D`], ['上移 / 下移块', 'Alt Shift ↑/↓'], ['缩进', 'Tab / Shift Tab'],
      ['选中当前块', 'Esc'], ['打开链接', `${MOD} 点击`],
    ]],
    ['Markdown 快捷输入（行首输入后加空格）', [
      ['标题', '# ~ ####'], ['无序列表', '- 或 ·'], ['有序列表', '1.'], ['任务列表', '[] 或 【】'],
      ['引用', '> 或 》'], ['代码块', '``` 或 ···'], ['分割线', '---'], ['粗体 / 斜体', '**文字** / *文字*'],
    ]],
  ];
  return (
    <Dialog title="快捷键" size="is-wide" onClose={onClose}>
      <div class="dlg-body">
        <div class="help-grid">
          {rows.map(([title, list]) => [
            <h5 key={title}>{title}</h5>,
            ...list.map(([label, keys]) => <div class="help-row" key={title + label}><span>{label}</span><K k={keys} /></div>),
          ])}
        </div>
      </div>
    </Dialog>
  );
}
