import { useSyncExternalStore } from 'react';

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
window.addEventListener('popstate', emit);

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const snapshot = () => window.location.pathname + window.location.search;

export function navigate(to, { replace = false } = {}) {
  if (to === snapshot()) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  if (!replace) window.scrollTo(0, 0);
  emit();
}

/** Current location as { path, query, segments }. Re-renders on navigation. */
export function useLocation() {
  const full = useSyncExternalStore(subscribe, snapshot);
  const [path, search = ''] = full.split('?');
  return { path, query: new URLSearchParams(search), segments: path.split('/').filter(Boolean).map(decodeURIComponent) };
}

export function Link({ to, className, children, ...rest }) {
  const onClick = (e) => {
    rest.onClick?.(e);
    if (rest.target || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={to} className={className} onClick={onClick}>{children}</a>;
}
