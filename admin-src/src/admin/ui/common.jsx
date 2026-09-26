import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icon } from '../../shared/icons.jsx';

export { Icon };

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';

/**
 * Context menu / dropdown. `anchor` is a DOMRect-like {left, top, bottom, right}
 * or {x, y} for a point.
 */
export function Menu({ anchor, onClose, items, align = 'start', width }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = anchor.x != null ? anchor.x : (align === 'end' ? anchor.right - w : anchor.left);
    let top = anchor.y != null ? anchor.y : anchor.bottom + 4;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (top + h > window.innerHeight - 8) top = anchor.y != null ? anchor.y - h : anchor.top - h - 4;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [anchor]);
  useEffect(() => {
    const down = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const blur = () => onClose();
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
    };
  }, [onClose]);
  return createPortal(
    <div class="menu" ref={ref} style={{ left: pos.left + 'px', top: pos.top + 'px', minWidth: width ? width + 'px' : undefined }} onContextMenu={e => e.preventDefault()}>
      {items.filter(Boolean).map((it, i) => {
        if (it === '-') return <div key={i} class="menu-sep" />;
        if (it.label && !it.run) return <div key={i} class="menu-label">{it.label}</div>;
        return (
          <button key={i} type="button" class={`menu-item${it.danger ? ' is-danger' : ''}`} disabled={it.disabled}
            onClick={() => { onClose(); it.run(); }}>
            {it.icon && <Icon name={it.icon} size={15} />}
            <span>{it.text}</span>
            {it.kbd && <span class="menu-kbd">{it.kbd}</span>}
            {it.desc && <span class="menu-desc">{it.desc}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export function useMenu() {
  const [menu, setMenu] = useState(null);
  const open = (e, items, opts = {}) => {
    e.preventDefault();
    e.stopPropagation();
    const anchor = e.type === 'contextmenu' ? { x: e.clientX, y: e.clientY } : e.currentTarget.getBoundingClientRect();
    setMenu({ anchor, items, ...opts });
  };
  const close = () => setMenu(null);
  const node = menu ? <Menu anchor={menu.anchor} items={menu.items} align={menu.align} width={menu.width} onClose={close} /> : null;
  return { open, close, node, isOpen: !!menu };
}

export function Dialog({ title, onClose, children, footer, size = '', headExtra = null, closeOnOverlay = true }) {
  const ref = useRef(null);
  useEffect(() => {
    const key = e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', key);
    const prev = document.activeElement;
    const first = ref.current && ref.current.querySelector('[autofocus], input:not([type=hidden]):not([disabled]), textarea, select');
    if (first) setTimeout(() => first.focus(), 20);
    return () => {
      document.removeEventListener('keydown', key);
      if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div class="overlay" onMouseDown={e => { if (closeOnOverlay && e.target === e.currentTarget) onClose(); }}>
      <div class={`dialog ${size}`} ref={ref} role="dialog" aria-modal="true">
        <div class="dlg-head">
          <h3>{title}</h3>
          {headExtra}
          <button type="button" class="icon-btn" title="关闭 (Esc)" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        {children}
        {footer && <div class="dlg-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

const TOAST_ICON = { success: 'check', error: 'alert', warn: 'alert', info: 'info' };

export function Toasts({ shell, toasts }) {
  return (
    <div class="toasts" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} class={`toast is-${t.type}`}>
          <Icon name={TOAST_ICON[t.type] || 'info'} size={16} />
          <span class="toast-text">{t.text}</span>
          {t.action && <button type="button" class="btn is-small" onClick={() => { shell.dismissToast(t.id); t.action.run(); }}>{t.action.label}</button>}
          <button type="button" class="icon-btn is-small" title="关闭" onClick={() => shell.dismissToast(t.id)}><Icon name="x" size={13} /></button>
        </div>
      ))}
    </div>
  );
}

export function StatusDot({ status, conflict }) {
  if (conflict) return <span class="dot is-conflict" title="线上有新版本" />;
  if (status === 'new') return <span class="dot is-new" title="未发布" />;
  if (status === 'modified') return <span class="dot is-modified" title="有未发布的修改" />;
  return null;
}

export const STATUS_TEXT = {
  new: '未发布',
  modified: '有未发布的修改',
  published: '已发布',
};

export function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 10000) return '刚刚';
  if (diff < 60000) return `${Math.floor(diff / 1000)} 秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `今天 ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function useTicker(ms = 15000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN(n => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept = '*/*') {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}
