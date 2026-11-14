import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { get } from './api.js';
import { Icon } from './icons.jsx';
import { Link } from './router.jsx';

export function Button({ variant = 'plain', busy = false, className = '', children, ...rest }) {
  return (
    <button type="button" {...rest} className={`btn btn-${variant} ${className}`} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {children}
    </button>
  );
}

export function IconButton({ icon, label, filled, className = '', ...rest }) {
  return (
    <button type="button" {...rest} className={`icon-btn ${className}`} aria-label={label} title={label}>
      <Icon name={icon} filled={filled} />
    </button>
  );
}

/** Labelled input with hint and error text wired up for screen readers. */
export function Field({ label, hint, error, as = 'input', hideLabel = false, children, className = '', ...rest }) {
  const id = useId();
  const Tag = as;
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'field-invalid' : ''} ${className}`}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>{label}</label>
      <div className="field-control">
        <Tag id={id} placeholder={hideLabel ? label : undefined} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
        {children}
      </div>
      {hint && !error && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${id}-error`} role="alert">{error}</p>}
    </div>
  );
}

export function PasswordField({ label = 'Password', ...rest }) {
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} type={shown ? 'text' : 'password'} {...rest}>
      <button type="button" className="field-toggle" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}>
        <Icon name={shown ? 'eyeOff' : 'eye'} size={18} />
      </button>
    </Field>
  );
}

export function Check({ children, ...rest }) {
  return <label className="check"><input type="checkbox" {...rest} /><span>{children}</span></label>;
}

export function Avatar({ user, size = 'md' }) {
  const name = user?.displayName || user?.handle || '?';
  return user?.avatar
    ? <img className={`avatar avatar-${size}`} src={user.avatar} alt="" loading="lazy" />
    : <span className={`avatar avatar-${size} avatar-blank`} aria-hidden="true">{name[0].toUpperCase()}</span>;
}

export function Spinner({ label = 'Loading' }) {
  return <p className="spinner" role="status"><span aria-hidden="true" />{label}</p>;
}

export function Empty({ title, children }) {
  return <div className="empty"><h3>{title}</h3>{children && <div>{children}</div>}</div>;
}

export function ErrorNote({ error, retry }) {
  if (!error) return null;
  return (
    <div className="note note-error" role="alert">
      <p>{error.message || String(error)}</p>
      {retry && <Button variant="link" onClick={retry}>Try again</Button>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(([key, text, count]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} className={value === key ? 'tab tab-active' : 'tab'} onClick={() => onChange(key)}>
          {text}{count > 0 && <span className="count">{count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Native <dialog>: traps focus, closes on Escape, restores focus afterwards. */
export function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el.open) el.showModal();
    return () => { if (el.open) el.close(); };
  }, []);
  return (
    <dialog
      ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} aria-label={title}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="modal-body">
        <header className="modal-head">
          <h2>{title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function Confirm({ title, children, action, danger = false, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true); setError(null);
    try { await onConfirm(); onClose(); } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {children}
        <ErrorNote error={error} />
        <div className="row row-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'solid'} busy={busy} onClick={go}>{action}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Small pop-up menu for the "more" button. */
export function Menu({ label = 'More', items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="menu" ref={ref}>
      <IconButton icon="more" label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="menu-list" role="menu">
          {shown.map((item) => (
            <button key={item.label} type="button" role="menuitem" className={item.danger ? 'menu-item menu-danger' : 'menu-item'} onClick={() => { setOpen(false); item.onSelect(); }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`;
  const d = new Date(ms);
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `, ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

export function Time({ at }) {
  const d = new Date(at);
  return <time dateTime={d.toISOString()} title={d.toLocaleString()}>{timeAgo(at)}</time>;
}

/** Fetch once (and again when `path` changes). Returns { data, error, loading, reload, setData }. */
export function useLoad(path) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { setState({ data: null, error: null, loading: false }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, error: null, loading: true }));
    get(path).then(
      (data) => { if (live) setState({ data, error: null, loading: false }); },
      (error) => { if (live) setState({ data: null, error, loading: false }); },
    );
    return () => { live = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload, setData };
}

/** Paged list: { items, loading, error, more, loadMore, reload, setItems }. */
export function usePaged(path) {
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const run = useRef(0);

  const fetchPage = useCallback(async (cursor) => {
    const id = ++run.current;
    setLoading(true); setError(null);
    try {
      const sep = path.includes('?') ? '&' : '?';
      const data = await get(cursor ? `${path}${sep}offset=${cursor.offset}&until=${cursor.until}` : path);
      if (id !== run.current) return;
      setItems((old) => (cursor ? [...old, ...data.items.filter((n) => !old.some((o) => o.key && o.key === n.key))] : data.items));
      setNext(data.next || null);
    } catch (err) { if (id === run.current) setError(err); }
    finally { if (id === run.current) setLoading(false); }
  }, [path]);

  useEffect(() => { setItems([]); setNext(null); fetchPage(null); }, [fetchPage]);

  return { items, setItems, loading, error, more: !!next, loadMore: () => fetchPage(next), reload: () => fetchPage(null) };
}

export function LoadMore({ list }) {
  if (list.loading && list.items.length) return <Spinner label="Loading more" />;
  if (!list.more) return null;
  return <div className="load-more"><Button onClick={list.loadMore}>Show more</Button></div>;
}

export function UserRow({ user, children, link = true }) {
  const body = (
    <>
      <Avatar user={user} />
      <span className="user-row-text">
        <span className="user-row-name">{user.displayName}</span>
        <span className="muted">@{user.handle}</span>
        {user.bio && <span className="user-row-bio">{user.bio}</span>}
      </span>
    </>
  );
  return (
    <div className="user-row">
      {link ? <Link className="user-row-main" to={`/u/${user.handle}`}>{body}</Link> : <div className="user-row-main">{body}</div>}
      {children}
    </div>
  );
}

/** Text with @mentions and web links made clickable. Never uses raw HTML. */
export function RichText({ text, className = '' }) {
  const parts = String(text || '').split(/(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]|(?<![\w@])@[a-z0-9_]{3,20}\b)/gi);
  return (
    <p className={`rich ${className}`}>
      {parts.map((part, i) => {
        if (/^https?:\/\//i.test(part)) return <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow ugc">{part.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 48)}</a>;
        if (/^@[a-z0-9_]{3,20}$/i.test(part)) return <Link key={i} to={`/u/${part.slice(1).toLowerCase()}`}>{part}</Link>;
        return part;
      })}
    </p>
  );
}
