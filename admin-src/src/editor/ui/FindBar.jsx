import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../shared/icons.jsx';
import { findKey } from '../ext/find.js';
import { Btn } from './Floating.jsx';

function scrollToMatch(ed, m) {
  if (!m) return;
  try {
    const c = ed.view.coordsAtPos(m.from);
    if (c.top < 90 || c.bottom > window.innerHeight - 60) {
      window.scrollTo({ top: window.scrollY + c.top - window.innerHeight / 3 });
    }
  } catch { /* position gone */ }
}

export function FindBar({ app, find }) {
  const ed = app.editor;
  const inputRef = useRef(null);
  const [query, setQuery] = useState(find.query || '');
  const [repl, setRepl] = useState('');
  const [cs, setCs] = useState(false);
  const [showReplace, setShowReplace] = useState(!!find.replace);

  useEffect(() => {
    if (find.query) setQuery(find.query);
    setShowReplace(!!find.replace);
    setTimeout(() => { if (inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, 0);
  }, [find.focusTick]);

  useEffect(() => {
    if (!ed) return;
    ed.commands.setFind({ query, caseSensitive: cs, anchor: ed.state.selection.from });
  }, [query, cs]);

  const st = ed ? findKey.getState(ed.state) : null;
  const cur = st && st.current >= 0 ? st.matches[st.current] : null;
  useEffect(() => { if (cur) scrollToMatch(ed, cur); }, [cur && cur.from, st && st.matches.length]);

  if (!ed || !st) return null;
  const count = st.matches.length;
  const step = dir => ed.commands.findStep(dir);
  const close = () => app.closeFind();

  return (
    <div class="ui-panel ui-find" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
      <div class="ui-row">
        <Btn title={showReplace ? '收起替换' : '展开替换'} icon={<Icon name={showReplace ? 'down' : 'right'} size={14} />} onClick={() => setShowReplace(!showReplace)} />
        <input ref={inputRef} class="ui-input" placeholder="查找" value={query} onInput={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
          }} />
        <span class="ui-find-count">{query ? (count ? `${st.current + 1}/${count}` : '无结果') : ''}</span>
        <Btn title="区分大小写" active={cs} icon={<Icon name="caseSensitive" size={15} />} onClick={() => setCs(!cs)} />
        <Btn title="上一个  Shift+Enter" disabled={!count} icon={<Icon name="up" size={15} />} onClick={() => step(-1)} />
        <Btn title="下一个  Enter" disabled={!count} icon={<Icon name="down" size={15} />} onClick={() => step(1)} />
        <Btn title="关闭  Esc" icon={<Icon name="x" size={15} />} onClick={close} />
      </div>
      {showReplace && (
        <div class="ui-row" style={{ paddingLeft: '32px' }}>
          <input class="ui-input" placeholder="替换为" value={repl} onInput={e => setRepl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ed.commands.replaceCurrent(repl); } }} />
          <button type="button" class="ui-ghost" disabled={!count} onClick={() => ed.commands.replaceCurrent(repl)}>替换</button>
          <button type="button" class="ui-ghost" disabled={!count} onClick={() => {
            const n = count;
            ed.commands.replaceAll(repl);
            app.host.toast(`已替换 ${n} 处`, 'success');
          }}>全部替换</button>
        </div>
      )}
    </div>
  );
}
