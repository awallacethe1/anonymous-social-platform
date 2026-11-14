import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get, setCsrf } from './api.js';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

/** Live events from the server (new messages, notifications). Components subscribe with useLive. */
const bus = new EventTarget();

export function useLive(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (e) => ref.current(e.detail);
    bus.addEventListener(event, fn);
    return () => bus.removeEventListener(event, fn);
  }, [event]);
}

export function AppProvider({ children }) {
  const [me, setMe] = useState(undefined); // undefined = still checking, null = signed out
  const [counts, setCounts] = useState({ notifications: 0, messages: 0, questions: 0 });
  const [toasts, setToasts] = useState([]);
  const [serverDown, setServerDown] = useState(false);

  const toast = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const refreshCounts = useCallback(() => { get('/api/counts').then(setCounts).catch(() => {}); }, []);

  /** Call with the reply from any sign-in route (or null after signing out). */
  const signIn = useCallback((reply) => {
    if (!reply?.user) { setCsrf(''); setMe(null); return; }
    if (reply.csrf) setCsrf(reply.csrf);
    if (reply.counts) setCounts(reply.counts);
    setMe(reply.user);
  }, []);

  // If the very first request cannot reach the API, say so instead of showing a sign-in form that cannot work.
  const check = useCallback(() => {
    get('/api/session').then((reply) => { setServerDown(false); signIn(reply); }, () => { setServerDown(true); setMe(null); });
  }, [signIn]);

  useEffect(() => {
    check();
    const out = () => signIn(null);
    window.addEventListener('anonymous:signed-out', out);
    return () => window.removeEventListener('anonymous:signed-out', out);
  }, [signIn, check]);

  const handle = me?.handle;
  useEffect(() => {
    if (!handle) return undefined;
    const source = new EventSource('/api/events');
    const relay = (name) => source.addEventListener(name, (e) => {
      let detail = {};
      try { detail = JSON.parse(e.data); } catch { /* ignore */ }
      bus.dispatchEvent(new CustomEvent(name, { detail }));
      refreshCounts();
    });
    ['message', 'notification', 'counts', 'read'].forEach(relay);
    const onVisible = () => { if (document.visibilityState === 'visible') refreshCounts(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { source.close(); document.removeEventListener('visibilitychange', onVisible); };
  }, [handle, refreshCounts]);

  const value = useMemo(() => ({ me, setMe, signIn, counts, refreshCounts, toast, serverDown, retry: check }), [me, signIn, counts, refreshCounts, toast, serverDown, check]);

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.message}</div>)}
      </div>
    </AppContext.Provider>
  );
}
