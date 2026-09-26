import { Icon, useMenu, relTime, useTicker, STATUS_TEXT, MOD } from './common.jsx';
import { KIND_LABEL } from '../data.js';

export const DEVICES = [
  { id: 'auto', label: '自适应', icon: 'maximize', width: null },
  { id: 'desktop', label: '桌面', icon: 'monitor', width: 1440 },
  { id: 'tablet', label: '平板', icon: 'tablet', width: 820 },
  { id: 'phone', label: '手机', icon: 'phone', width: 390 },
];

export function TopBar({ shell, st }) {
  useTicker(15000);
  const data = shell.data;
  const id = st.currentId;
  const found = id ? data.find(id) : null;
  const status = found ? data.status(id) : null;
  const more = useMenu();
  const pubMenu = useMenu();
  const changes = data.pendingChanges();
  const changeCount = changes.docs.length + changes.takedowns.length;
  const publishing = st.publishing;

  const crumbParent = found ? (found.kind === 'galleryItem' ? `画廊 / ${found.cat.name}` : KIND_LABEL[found.kind]) : '';

  const openMore = e => more.open(e, [
    { icon: 'eye', text: '预览发布效果', kbd: `${MOD}+Shift+P`, run: () => shell.openDialog({ type: 'preview' }) },
    { icon: 'history', text: '历史版本', disabled: !found, run: () => shell.openDialog({ type: 'history', docId: id }) },
    { icon: 'search', text: '查找和替换', kbd: `${MOD}+F`, disabled: !found, run: () => shell.api && shell.api.exec('find', false) },
    '-',
    { icon: 'external', text: '打开线上页面', disabled: !found || !data.pubOf(id), run: () => window.open(shell.liveUrl(id), '_blank', 'noopener') },
    { icon: 'refresh', text: '从线上同步', run: () => shell.sync({ force: true }) },
    status === 'modified' && { icon: 'undo', text: '放弃本地修改', run: async () => {
      const ok = await shell.confirm({ title: '放弃本地修改？', text: '恢复成网站上的版本。当前内容会先存进历史版本，可以找回。', ok: '放弃修改', danger: true });
      if (ok) { await data.discardLocal(id); shell.store.set(s => ({ conflicts: s.conflicts.filter(x => x !== id) })); shell.openDoc(id, { force: true }); }
    } },
    '-',
    { icon: 'keyboard', text: '快捷键', kbd: `${MOD}+/`, run: () => shell.openDialog({ type: 'help' }) },
    { icon: 'settings', text: '设置', run: () => shell.openDialog({ type: 'settings' }) },
  ], { align: 'end', width: 220 });

  const openPubMenu = e => pubMenu.open(e, [
    { icon: 'send', text: changeCount ? `发布全部更改（${changeCount}）` : '发布全部更改', disabled: !changeCount && !changes.structure.length, run: () => shell.openDialog({ type: 'publish' }) },
    found && data.pubOf(id) && { icon: 'cloudOff', text: '从网站撤下此页', run: () => shell.unpublishDoc(id) },
    '-',
    { icon: 'refresh', text: '重新生成全站页面', desc: '修复样式用', run: async () => {
      const ok = await shell.confirm({ title: '重新生成全站页面？', text: '用当前的页面模板重新生成所有已发布的页面，内容保持线上版本，不会发布未发布的草稿。', ok: '重新生成' });
      if (ok) shell.publish({ rebuildAll: true, label: '重新生成全站' });
    } },
  ], { align: 'end', width: 240 });

  let primaryText = '发布';
  if (status === 'modified') primaryText = '发布更新';
  if (status === 'published') primaryText = '已发布';

  return (
    <header class="topbar">
      {!st.sidebar && <button type="button" class="icon-btn" title={`展开侧边栏 (${MOD}+\\)`} onClick={() => shell.setUI({ sidebar: true })}><Icon name="sidebar" size={16} /></button>}
      {found && (
        <div class="crumbs">
          <span class="hide-narrow">{crumbParent}</span>
          <span class="crumb-sep hide-narrow">/</span>
          <span class="crumb-title">{found.meta.title || '无标题'}</span>
        </div>
      )}
      {found && (
        <span class="status-pill" title={status === 'published' ? '网站上就是现在这个版本' : '修改只保存在本机，发布后才会出现在网站上'}>
          <span class={`dot is-${st.conflicts.includes(id) ? 'conflict' : status}`} />
          {STATUS_TEXT[status]}
        </span>
      )}
      {found && st.savedAt && <span class="saved-at hide-narrow" title="草稿自动保存在本机浏览器里">已保存 {relTime(st.savedAt)}</span>}
      <div class="tb-spacer" />
      {!st.gh.hasToken && <span class="gh-warn hide-narrow" onClick={() => shell.openDialog({ type: 'settings', section: 'github' })}><Icon name="alert" size={14} />未连接 GitHub</span>}
      {st.deploy && (
        <span class={`deploy-pill${st.deploy.state === 'live' ? ' is-live' : ''}${st.deploy.state === 'timeout' ? ' is-timeout' : ''}`}
          title={st.deploy.state === 'waiting' ? 'GitHub Pages 通常需要 30 秒到 2 分钟' : ''}
          onClick={() => st.deploy.state === 'live' && st.deploy.url && window.open(st.deploy.url, '_blank', 'noopener')}>
          {st.deploy.state === 'waiting' && <><span class="spinner" />网站更新中…</>}
          {st.deploy.state === 'live' && <><Icon name="check" size={14} />已上线，点击查看</>}
          {st.deploy.state === 'timeout' && <><Icon name="alert" size={14} />部署较慢，稍后刷新网站看看</>}
        </span>
      )}
      <div class="tb-group hide-narrow">
        <button type="button" class="icon-btn" title={`撤销 (${MOD}+Z)`} disabled={!found} onClick={() => shell.api && shell.api.exec('undo')}><Icon name="undo" size={16} /></button>
        <button type="button" class="icon-btn" title={`重做 (${MOD}+Shift+Z)`} disabled={!found} onClick={() => shell.api && shell.api.exec('redo')}><Icon name="redo" size={16} /></button>
      </div>
      <div class="tb-sep hide-narrow" />
      <div class="seg hide-narrow" title="按不同屏幕宽度编辑和检查排版">
        {DEVICES.map(d => (
          <button type="button" key={d.id} class={st.device === d.id ? 'is-active' : ''} title={d.width ? `${d.label} ${d.width}px` : '跟随窗口宽度'} onClick={() => shell.setDevice(d.id)}>
            <Icon name={d.icon} size={14} />{st.device === d.id && <span>{d.label}</span>}
          </button>
        ))}
      </div>
      <div class="tb-sep hide-narrow" />
      <button type="button" class="btn is-ghost hide-narrow" disabled={!found} onClick={() => shell.openDialog({ type: 'preview' })} title={`${MOD}+Shift+P`}><Icon name="eye" size={15} />预览</button>
      <div class="publish-btn">
        <button type="button" class={`btn ${status === 'published' ? '' : 'is-primary'}`} disabled={!found || !!publishing || status === 'published'}
          onClick={() => shell.publishCurrent()}
          title={status === 'published' ? '网站上已是最新版本' : '把这篇文档发布到网站'}>
          {publishing ? <><span class="spinner" />发布中…</> : <><Icon name={status === 'published' ? 'check' : 'send'} size={14} />{primaryText}</>}
        </button>
        <button type="button" class={`btn ${status === 'published' ? '' : 'is-primary'}`} disabled={!!publishing} title="更多发布选项" onClick={openPubMenu}>
          <Icon name="down" size={13} />
          {changeCount > 0 && status === 'published' && <span class="sb-count" style={{ color: 'var(--amber)' }}>{changeCount}</span>}
        </button>
      </div>
      <button type="button" class="icon-btn" title="更多" onClick={openMore}><Icon name="more" size={16} /></button>
      <button type="button" class={`icon-btn${st.panel ? ' is-active' : ''}`} title="页面设置面板" onClick={() => shell.setUI({ panel: !st.panel })}><Icon name="panel" size={16} /></button>
      {more.node}
      {pubMenu.node}
    </header>
  );
}
