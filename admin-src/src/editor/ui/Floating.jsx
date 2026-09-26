import { useLayoutEffect, useRef, useEffect } from 'preact/hooks';
import { computePosition, flip, shift, offset as offsetMw } from '@floating-ui/dom';

const ZERO = () => new DOMRect(0, 0, 0, 0);

/**
 * Absolutely positioned panel anchored to a viewport rect. #ui-root sits at the
 * document origin, so panels scroll together with the content they point at.
 */
export function Floating({ getRect, placement = 'bottom-start', offset = 8, fallback, className = '', children, keepFocus = false, onKeyDown, style, sticky = false }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !getRect) return undefined;
    let cancelled = false;
    const reference = { getBoundingClientRect: () => getRect() || ZERO() };
    const update = () => computePosition(reference, el, {
      placement,
      strategy: 'absolute',
      middleware: [offsetMw(offset), flip({ padding: 8, fallbackPlacements: fallback }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      if (cancelled) return;
      if (sticky) {
        // Tall blocks keep their toolbar inside the viewport while any part of them is visible.
        const r = reference.getBoundingClientRect();
        const h = el.offsetHeight;
        if (r.bottom > h + 16 && r.top < window.innerHeight - h - 16) {
          y = Math.max(window.scrollY + 8, Math.min(y, window.scrollY + window.innerHeight - h - 8));
        }
      }
      el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
      el.style.visibility = 'visible';
    });
    update();
    if (sticky) window.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelled = true;
      if (sticky) window.removeEventListener('scroll', update);
    };
  });
  const onMouseDown = keepFocus ? e => {
    if (!e.target.closest('input,textarea,select,[contenteditable="true"]')) e.preventDefault();
  } : undefined;
  return (
    <div ref={ref} class={`ui-float ${className}`} style={{ visibility: 'hidden', ...(style || {}) }} onMouseDown={onMouseDown} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

/** Calls onClose when the user presses outside the panel (and outside `ignore` elements). */
export function useDismiss(ref, onClose, ignore = []) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    const down = e => {
      const el = ref.current;
      if (!el) return;
      if (el.contains(e.target)) return;
      for (const x of ignore) if (x && x.contains && x.contains(e.target)) return;
      cb.current();
    };
    document.addEventListener('mousedown', down, true);
    return () => document.removeEventListener('mousedown', down, true);
  }, []);
}

export function elRect(el) {
  return () => (el && el.isConnected ? el.getBoundingClientRect() : null);
}

export function Btn({ icon, label, active, danger, disabled, onClick, title, kbd, children, class: cls = '' }) {
  return (
    <button type="button" class={`ui-btn ${active ? 'is-active' : ''} ${danger ? 'is-danger' : ''} ${cls}`} disabled={disabled}
      title={title ? (kbd ? `${title}  ${kbd}` : title) : undefined} onClick={onClick}>
      {icon}
      {label && <span class="ui-btn-text">{label}</span>}
      {children}
    </button>
  );
}

export function MenuItem({ icon, title, desc, kbd, active, selected, danger, compact, onClick, onMouseEnter }) {
  return (
    <button type="button" class={`ui-menu-item ${active ? 'is-active' : ''} ${selected ? 'is-selected' : ''} ${danger ? 'is-danger' : ''} ${compact ? 'is-compact' : ''}`}
      onClick={onClick} onMouseEnter={onMouseEnter}>
      {icon && <span class="ui-mi-icon">{icon}</span>}
      <span class="ui-mi-text">
        <span class="ui-mi-title">{title}</span>
        {desc && <span class="ui-mi-desc">{desc}</span>}
      </span>
      {kbd && <span class="ui-mi-kbd">{kbd}</span>}
    </button>
  );
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';
