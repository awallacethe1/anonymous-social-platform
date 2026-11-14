import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { get, post as send } from '../api.js';
import { useApp, useLive } from '../state.jsx';
import { Link, navigate } from '../router.jsx';
import { Icon } from '../icons.jsx';
import { Avatar, Button, Empty, ErrorNote, IconButton, Menu, Spinner, Time, useLoad } from '../ui.jsx';
import { BlockDialog, PersonPicker, ReportDialog } from '../components/Post.jsx';
import { LIMITS } from '../../shared/constants.js';

function ConversationList({ active }) {
  const { data, error, loading, reload } = useLoad('/api/conversations');
  const [starting, setStarting] = useState(false);
  useLive('message', reload);
  useLive('counts', reload);
  return (
    <div className="convo-list">
      <header className="page-head">
        <h2 className="page-title">Messages</h2>
        <Button variant="solid" className="btn-small" onClick={() => setStarting(!starting)} aria-expanded={starting}>New message</Button>
      </header>
      {starting && <div className="panel"><PersonPicker label="Who do you want to message?" autoFocus onPick={(u) => { setStarting(false); navigate(`/messages/${u.handle}`); }} /></div>}
      {loading && !data && <Spinner />}
      <ErrorNote error={error} retry={reload} />
      {data?.items.length === 0 && !starting && <Empty title="No messages yet">Start a conversation with “New message”, or from someone’s profile.</Empty>}
      <ul className="plain-list">
        {data?.items.map((c) => (
          <li key={c.user.handle}>
            <Link className={active === c.user.handle ? 'convo convo-active' : 'convo'} to={`/messages/${c.user.handle}`} aria-current={active === c.user.handle ? 'page' : undefined}>
              <Avatar user={c.user} />
              <span className="convo-text">
                <span className="row row-between"><span className={c.unread ? 'convo-name convo-unread' : 'convo-name'}>{c.user.displayName}</span><span className="muted small"><Time at={c.last.createdAt} /></span></span>
                <span className={c.unread ? 'convo-preview convo-unread' : 'convo-preview muted'}>{c.last.mine ? 'You: ' : ''}{c.last.body}</span>
              </span>
              {c.unread > 0 && <span className="count" aria-label={`${c.unread} unread`}>{c.unread}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Thread({ handle }) {
  const { toast, refreshCounts } = useApp();
  const [state, setState] = useState({ loading: true, error: null, user: null, messages: [], hasMore: false, canMessage: false });
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);
  const endRef = useRef(null);
  const stick = useRef(true);

  const load = () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    get(`/api/conversations/${handle}`).then(
      (d) => { stick.current = true; setState({ loading: false, error: null, ...d }); refreshCounts(); },
      (error) => setState((s) => ({ ...s, loading: false, error })),
    );
  };
  useEffect(load, [handle]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (m) => setState((s) => (s.messages.some((x) => x.id === m.id) ? s : { ...s, messages: [...s.messages, m] }));

  useLive('message', (e) => {
    if (e.with !== handle) return;
    stick.current = true;
    add(e.message);
    // Fetching the conversation is what marks an incoming message as read.
    if (!e.message.mine && document.visibilityState === 'visible') get(`/api/conversations/${handle}`).then(refreshCounts, () => {});
  });
  useLive('read', (e) => { if (e.by === handle) setState((s) => ({ ...s, messages: s.messages.map((m) => (m.mine ? { ...m, read: true } : m)) })); });

  useLayoutEffect(() => { if (stick.current) endRef.current?.scrollIntoView({ block: 'end' }); }, [state.messages.length]);

  const earlier = async () => {
    try {
      const d = await get(`/api/conversations/${handle}?before=${state.messages[0].id}`);
      stick.current = false;
      setState((s) => ({ ...s, hasMore: d.hasMore, messages: [...d.messages, ...s.messages] }));
    } catch (err) { toast(err.message, 'error'); }
  };

  const submit = async (e) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try { const { message } = await send(`/api/conversations/${handle}`, { body: text }); stick.current = true; add(message); setBody(''); }
    catch (err) { toast(err.message, 'error'); }
    setBusy(false);
  };

  if (state.loading && !state.user) return <div className="thread"><Spinner /></div>;
  if (state.error) {
    return (
      <div className="thread">
        {state.error.status === 404 ? <Empty title="This conversation is not available"><Link to="/messages">Back to messages</Link></Empty> : <ErrorNote error={state.error} retry={load} />}
      </div>
    );
  }

  const { user, messages } = state;
  const lastMine = [...messages].reverse().find((m) => m.mine);
  const lastIncoming = [...messages].reverse().find((m) => !m.mine);

  return (
    <div className="thread">
      <header className="thread-head">
        <Link className="thread-back" to="/messages" aria-label="Back to messages"><Icon name="back" /></Link>
        <Link className="post-author" to={`/u/${user.handle}`}><Avatar user={user} /><span><span className="post-name">{user.displayName}</span> <span className="muted">@{user.handle}</span></span></Link>
        <Menu label="Conversation options" items={[
          { label: 'View profile', onSelect: () => navigate(`/u/${user.handle}`) },
          lastIncoming && { label: 'Report their last message', onSelect: () => setDialog('report') },
          { label: `Block @${user.handle}`, danger: true, onSelect: () => setDialog('block') },
        ]} />
      </header>

      <div className="thread-body" role="log" aria-label={`Conversation with ${user.displayName}`}>
        {state.hasMore && <div className="load-more"><Button className="btn-small" onClick={earlier}>Show earlier messages</Button></div>}
        {messages.length === 0 && <p className="muted thread-empty">This is the start of your conversation with {user.displayName}.</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const gap = !prev || m.createdAt - prev.createdAt > 30 * 60_000;
          return (
            <div key={m.id}>
              {gap && <p className="thread-time muted small"><Time at={m.createdAt} /></p>}
              <p className={m.mine ? 'bubble bubble-mine' : 'bubble'}>{m.body}</p>
              {m === lastMine && m.read && <p className="thread-seen muted small">Seen</p>}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {state.canMessage ? (
        <form className="thread-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="message-body">Message</label>
          <textarea id="message-body" rows={1} maxLength={LIMITS.message} placeholder={`Message ${user.displayName}`} value={body} onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          <IconButton icon="send" label="Send" type="submit" className="icon-btn-solid" disabled={!body.trim() || busy} />
        </form>
      ) : <p className="thread-closed muted">{user.displayName} is not accepting messages from you.</p>}

      {dialog === 'block' && <BlockDialog handle={user.handle} onClose={() => setDialog(null)} onDone={() => navigate('/messages')} />}
      {dialog === 'report' && <ReportDialog targetType="message" targetId={lastIncoming.id} handle={user.handle} onClose={() => setDialog(null)} onBlocked={() => navigate('/messages')} />}
    </div>
  );
}

export default function Messages({ handle }) {
  return (
    <section className={handle ? 'messages messages-open' : 'messages'}>
      <ConversationList active={handle} />
      {handle
        ? <Thread key={handle} handle={handle} />
        : <div className="thread thread-placeholder"><p className="muted">Choose a conversation.</p></div>}
    </section>
  );
}
