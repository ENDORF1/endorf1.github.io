import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../../editor/store.js';
import { Icon, Toasts } from './common.jsx';
import { Sidebar } from './Sidebar.jsx';
import { TopBar } from './TopBar.jsx';
import { Stage } from './Stage.jsx';
import { Panel } from './Panel.jsx';
import { DialogHost } from './Dialogs.jsx';

function Lock({ shell }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    if (!pw) return;
    setBusy(true);
    const ok = await shell.unlock(pw);
    setBusy(false);
    if (!ok) { setErr('密码不正确'); setPw(''); }
  };
  return (
    <div class="lock">
      <div class="lock-card">
        <div class="lock-logo">_DEV.LOG</div>
        <div class="lock-sub">网站后台 · 输入密码继续</div>
        <form onSubmit={submit}>
          <input class="input" type="password" autoFocus placeholder="后台密码" value={pw} autocomplete="current-password"
            onInput={e => { setPw(e.target.value); setErr(''); }} />
          <div class="lock-err">{err}</div>
          <button type="submit" class="btn is-primary is-block" disabled={busy || !pw}>{busy ? <span class="spinner" /> : null}进入后台</button>
        </form>
      </div>
    </div>
  );
}

function Boot({ st }) {
  return (
    <div class="lock">
      {st.phase === 'error' ? (
        <div class="boot-err">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}><Icon name="alert" size={16} />后台启动失败</div>
          {st.bootError}
          <div style={{ marginTop: '14px' }}><button type="button" class="btn" onClick={() => location.reload()}>重新加载</button></div>
        </div>
      ) : (
        <div class="boot-msg"><span class="spinner" />{st.bootMsg || '正在启动…'}</div>
      )}
    </div>
  );
}

function PublishProgress({ st }) {
  const p = st.publishing;
  if (!p || (st.dialog && st.dialog.type === 'publish')) return null;
  const last = p.progress[p.progress.length - 1];
  return (
    <div class="toasts" style={{ bottom: '72px' }}>
      <div class="toast is-info"><span class="spinner" /><span class="toast-text"><b>{p.label}</b>　{last}</span></div>
    </div>
  );
}

function useGlobalKeys(shell) {
  useEffect(() => {
    const onKey = e => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); shell.saveNow(); }
      else if (k === 'p' && e.shiftKey) { e.preventDefault(); if (shell.store.get().currentId) shell.openDialog({ type: 'preview' }); }
      else if (k === 'p') { e.preventDefault(); shell.setUI({ sidebar: true }); setTimeout(() => shell.focusSearch && shell.focusSearch(), 30); }
      else if (k === '\\') { e.preventDefault(); shell.setUI({ sidebar: !shell.store.get().sidebar }); }
      else if (k === '/') { e.preventDefault(); shell.openDialog({ type: 'help' }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

export function App({ shell }) {
  const st = useStore(shell.store);
  useGlobalKeys(shell);
  if (st.phase === 'lock') return <><Lock shell={shell} /><Toasts shell={shell} toasts={st.toasts} /></>;
  if (st.phase !== 'ready') return <Boot st={st} />;
  return (
    <div class={`app${st.sidebar ? '' : ' no-sidebar'}${st.panel ? '' : ' no-panel'}`}>
      <Sidebar shell={shell} st={st} />
      <div class="main">
        <TopBar shell={shell} st={st} />
        <div class="workarea">
          <Stage shell={shell} st={st} />
          <Panel shell={shell} st={st} />
        </div>
      </div>
      <DialogHost shell={shell} st={st} />
      <PublishProgress st={st} />
      <Toasts shell={shell} toasts={st.toasts} />
    </div>
  );
}
