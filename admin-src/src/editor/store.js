import { useEffect, useReducer, useRef } from 'preact/hooks';

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      for (const fn of subs) fn(state);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

export function useStore(store, selector = s => s) {
  const [, force] = useReducer(x => x + 1, 0);
  const selRef = useRef(selector);
  selRef.current = selector;
  const valRef = useRef();
  valRef.current = selector(store.get());
  useEffect(() => store.subscribe(s => {
    const next = selRef.current(s);
    if (!shallowEqual(next, valRef.current)) force();
  }), [store]);
  return valRef.current;
}
