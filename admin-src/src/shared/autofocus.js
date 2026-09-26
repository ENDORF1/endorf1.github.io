import { options } from 'preact';

/** Browsers ignore the autofocus attribute on elements inserted after the page has loaded, so focus them on mount. */
export function installAutoFocus() {
  const prev = options.vnode;
  options.vnode = vnode => {
    const props = vnode.props;
    if (typeof vnode.type === 'string' && props && props.autoFocus) {
      delete props.autoFocus;
      const userRef = vnode.ref;
      vnode.ref = el => {
        if (el && !el.__autoFocused) {
          el.__autoFocused = true;
          setTimeout(() => {
            if (!el.isConnected) return;
            el.focus({ preventScroll: true });
            if (typeof el.select === 'function' && el.value && el.type !== 'date') el.select();
          }, 0);
        }
        if (typeof userRef === 'function') userRef(el);
        else if (userRef) userRef.current = el;
      };
    }
    if (prev) prev(vnode);
  };
}
