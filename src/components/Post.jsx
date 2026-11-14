import { useEffect, useState } from 'react';
import { get, post as send, put, del } from '../api.js';
import { useApp } from '../state.jsx';
import { Link, navigate } from '../router.jsx';
import { Avatar, Button, Check, Confirm, ErrorNote, Field, Menu, Modal, RichText, Spinner, Time, UserRow } from '../ui.jsx';
import { LIMITS, REPORT_REASONS } from '../../shared/constants.js';

export function FollowButton({ user, onChange }) {
  const { toast } = useApp();
  const [following, setFollowing] = useState(user.following);
  const [busy, setBusy] = useState(false);
  if (user.isMe) return null;
  const toggle = async () => {
    setBusy(true);
    try {
      const res = following ? await del(`/api/users/${user.handle}/follow`) : await send(`/api/users/${user.handle}/follow`);
      setFollowing(res.following);
      onChange?.(res.following);
    } catch (err) { toast(err.message, 'error'); }
    setBusy(false);
  };
  return (
    <Button variant={following ? 'plain' : 'solid'} className="btn-small" busy={busy} onClick={toggle} aria-pressed={following}>
      {following ? 'Following' : 'Follow'}
    </Button>
  );
}

export function ReportDialog({ targetType, targetId, handle, onClose, onBlocked }) {
  const { toast } = useApp();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!reason) { setError(new Error('Choose a reason.')); return; }
    setBusy(true); setError(null);
    try {
      await send('/api/reports', { targetType, targetId, reason, details });
      if (block && handle) { await send(`/api/users/${handle}/block`); onBlocked?.(); }
      toast(block && handle ? `Reported, and @${handle} is blocked.` : 'Reported. A moderator will review it.');
      onClose();
    } catch (err) { setError(err); setBusy(false); }
  };

  return (
    <Modal title="Report" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <fieldset className="choices">
          <legend>What is wrong?</legend>
          {REPORT_REASONS.map(([key, label]) => (
            <label key={key} className="choice">
              <input type="radio" name="reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <Field as="textarea" label="Anything a moderator should know (optional)" rows={3} maxLength={LIMITS.reportDetails} value={details} onChange={(e) => setDetails(e.target.value)} />
        {handle && <Check checked={block} onChange={(e) => setBlock(e.target.checked)}>Also block @{handle}</Check>}
        <p className="muted small">Reports are private. The person you report is not told who reported them.</p>
        <ErrorNote error={error} />
        <div className="row row-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="solid" type="submit" busy={busy}>Send report</Button>
        </div>
      </form>
    </Modal>
  );
}

export function BlockDialog({ handle, onClose, onDone }) {
  const { toast } = useApp();
  return (
    <Confirm
      title={`Block @${handle}?`} action="Block" danger onClose={onClose}
      onConfirm={async () => { await send(`/api/users/${handle}/block`); toast(`@${handle} is blocked.`); onDone?.(); }}
    >
      <p>They will not be able to see your profile or posts, follow you, message you or send you questions. You will not see theirs either. They are not told.</p>
    </Confirm>
  );
}

/** Choose which of your boards hold this post, or start a new board. */
export function SaveDialog({ post, onClose, onChange }) {
  const [boards, setBoards] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { get(`/api/boards?postId=${post.id}`).then((d) => setBoards(d.items), setError); }, [post.id]);

  const toggle = async (board) => {
    setError(null);
    try {
      const res = board.has ? await del(`/api/boards/${board.id}/items/${post.id}`) : await put(`/api/boards/${board.id}/items/${post.id}`);
      setBoards((list) => list.map((b) => (b.id === board.id ? { ...b, has: !board.has } : b)));
      if (res.post) onChange(res.post);
    } catch (err) { setError(err); }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      const { board } = await send('/api/boards', { name, isPrivate });
      const res = await put(`/api/boards/${board.id}/items/${post.id}`);
      setBoards((list) => [{ ...board, has: true }, ...list]);
      onChange(res.post);
      setName(''); setIsPrivate(false);
    } catch (err) { setError(err); }
    setBusy(false);
  };

  return (
    <Modal title="Save to a board" onClose={onClose}>
      <div className="stack">
        {!boards && !error && <Spinner />}
        {boards?.length === 0 && <p className="muted">You have no boards yet. Name your first one below.</p>}
        {boards?.length > 0 && (
          <ul className="plain-list board-picker">
            {boards.map((b) => (
              <li key={b.id}>
                <Check checked={b.has} onChange={() => toggle(b)}>
                  {b.name}{b.isPrivate && <span className="muted"> (private)</span>}
                </Check>
              </li>
            ))}
          </ul>
        )}
        <form className="stack stack-tight rule-top" onSubmit={create}>
          <Field label="New board" placeholder="Board name" maxLength={LIMITS.boardName} value={name} onChange={(e) => setName(e.target.value)} />
          <Check checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)}>Only I can see this board</Check>
          <ErrorNote error={error} />
          <div className="row row-end">
            <Button onClick={onClose}>Done</Button>
            <Button variant="solid" type="submit" busy={busy} disabled={!name.trim()}>Create and save</Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

export function PostCard({ item, post: initial, onRemoved, full = false }) {
  const { toast } = useApp();
  const [post, setPost] = useState(initial || item.post);
  const [dialog, setDialog] = useState(null);
  const [gone, setGone] = useState(false);
  const repostedBy = item?.repostedBy;
  if (gone) return null;

  const act = async (kind, on) => {
    // Update the button straight away, then settle on what the server says.
    const before = post;
    setPost(kind === 'like'
      ? { ...post, liked: !on, likeCount: post.likeCount + (on ? -1 : 1) }
      : { ...post, reposted: !on, repostCount: post.repostCount + (on ? -1 : 1) });
    try {
      const res = on ? await del(`/api/posts/${post.id}/${kind}`) : await send(`/api/posts/${post.id}/${kind}`);
      setPost(res.post);
    } catch (err) { setPost(before); toast(err.message, 'error'); }
  };

  const remove = async () => {
    await del(`/api/posts/${post.id}`);
    toast('Post deleted.');
    setGone(true);
    onRemoved?.(post.id);
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/post/${post.id}`); toast('Link copied.'); }
    catch { toast('Could not copy the link.', 'error'); }
  };

  const hide = () => { setGone(true); onRemoved?.(post.id); };

  return (
    <article className={full ? 'post post-full' : 'post'}>
      {repostedBy && (
        <p className="post-context"><Link to={`/u/${repostedBy.handle}`}>{repostedBy.displayName}</Link> reposted</p>
      )}
      <header className="post-head">
        <Link className="post-author" to={`/u/${post.author.handle}`}>
          <Avatar user={post.author} />
          <span>
            <span className="post-name">{post.author.displayName}</span>
            <span className="muted"> @{post.author.handle}</span>
          </span>
        </Link>
        <Link className="post-time muted" to={`/post/${post.id}`}><Time at={post.createdAt} /></Link>
        <Menu
          label="Post options"
          items={[
            { label: 'Copy link', onSelect: copyLink },
            post.mine && { label: 'Delete post', danger: true, onSelect: () => setDialog('delete') },
            !post.mine && { label: 'Report post', onSelect: () => setDialog('report') },
            !post.mine && { label: `Block @${post.author.handle}`, danger: true, onSelect: () => setDialog('block') },
          ]}
        />
      </header>

      {post.body && <RichText text={post.body} className="post-body" />}
      {post.image && (
        full
          ? <img className="post-image" src={post.image} alt="Image attached to this post" />
          : <Link to={`/post/${post.id}`}><img className="post-image" src={post.image} alt="Image attached to this post" loading="lazy" /></Link>
      )}
      {post.tags.length > 0 && (
        <p className="post-tags">{post.tags.map((t) => <Link key={t} className="tag" to={`/?tag=${t}`}>{t}</Link>)}</p>
      )}

      <footer className="actions">
        <button type="button" aria-pressed={post.liked} aria-label={post.liked ? 'Unlike' : 'Like'} className={post.liked ? 'on' : undefined} onClick={() => act('like', post.liked)}>
          {post.liked ? '♥' : '♡'} {post.likeCount}
        </button>
        <Link to={`/post/${post.id}`}>Comment {post.commentCount}</Link>
        {post.mine
          ? <span title="Reposts of your post">Repost {post.repostCount}</span>
          : (
            <button type="button" aria-pressed={post.reposted} aria-label={post.reposted ? 'Undo repost' : 'Repost'} className={post.reposted ? 'on' : undefined} onClick={() => act('repost', post.reposted)}>
              {post.reposted ? 'Reposted' : 'Repost'} {post.repostCount}
            </button>
          )}
        <button type="button" className={post.saved ? 'on' : undefined} aria-label={post.saved ? 'Saved. Change boards' : 'Save to a board'} onClick={() => setDialog('save')}>
          {post.saved ? 'Saved to board' : 'Save to board'}
        </button>
      </footer>

      {dialog === 'save' && <SaveDialog post={post} onClose={() => setDialog(null)} onChange={setPost} />}
      {dialog === 'report' && <ReportDialog targetType="post" targetId={post.id} handle={post.author.handle} onClose={() => setDialog(null)} onBlocked={hide} />}
      {dialog === 'block' && <BlockDialog handle={post.author.handle} onClose={() => setDialog(null)} onDone={hide} />}
      {dialog === 'delete' && (
        <Confirm title="Delete this post?" action="Delete post" danger onConfirm={remove} onClose={() => setDialog(null)}>
          <p>It will be removed from feeds, boards and your profile. This cannot be undone.</p>
        </Confirm>
      )}
    </article>
  );
}

/** A public answer to an anonymous question. */
export function AnswerCard({ answer, onRemoved }) {
  const { toast } = useApp();
  const [dialog, setDialog] = useState(null);
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const remove = async () => {
    await del(`/api/questions/${answer.id}`);
    toast('Answer removed.');
    setGone(true);
    onRemoved?.(answer.id);
  };
  return (
    <article className="post answer">
      <header className="post-head">
        <Link className="post-author" to={`/u/${answer.by.handle}`}>
          <Avatar user={answer.by} />
          <span>
            <span className="post-name">{answer.by.displayName}</span>
            <span className="muted"> answered an anonymous question</span>
          </span>
        </Link>
        <span className="post-time muted"><Time at={answer.answeredAt} /></span>
        <Menu
          label="Answer options"
          items={[
            answer.mine && { label: 'Remove answer', danger: true, onSelect: () => setDialog('delete') },
            !answer.mine && { label: 'Report', onSelect: () => setDialog('report') },
          ]}
        />
      </header>
      <blockquote className="asked">{answer.question}</blockquote>
      <RichText text={answer.answer} className="post-body" />
      {dialog === 'report' && <ReportDialog targetType="question" targetId={answer.id} handle={answer.by.handle} onClose={() => setDialog(null)} onBlocked={() => setGone(true)} />}
      {dialog === 'delete' && (
        <Confirm title="Remove this answer?" action="Remove" danger onConfirm={remove} onClose={() => setDialog(null)}>
          <p>The question and your answer will both be removed.</p>
        </Confirm>
      )}
    </article>
  );
}

export function FeedItem({ item, onRemoved }) {
  return item.type === 'answer'
    ? <AnswerCard answer={item.answer} onRemoved={onRemoved} />
    : <PostCard item={item} onRemoved={onRemoved} />;
}

/** Search for a person by name or username. */
export function PersonPicker({ label, onPick, autoFocus = false }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return undefined; }
    let live = true;
    const timer = setTimeout(() => {
      get(`/api/search?q=${encodeURIComponent(term)}`).then((d) => { if (live) setResults(d.users.filter((u) => !u.isMe)); }, () => {});
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [q]);
  return (
    <div className="picker">
      <Field label={label} type="search" placeholder="Name or @username" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} autoComplete="off" />
      {results && (
        <ul className="plain-list picker-results">
          {results.length === 0 && <li className="muted">Nobody matches “{q.trim()}”.</li>}
          {results.map((u) => (
            <li key={u.handle}>
              <button type="button" className="picker-option" onClick={() => { setQ(''); setResults(null); onPick(u); }}>
                <UserRow user={u} link={false} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AskDialog({ user, onClose }) {
  const { toast } = useApp();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await send(`/api/users/${user.handle}/questions`, { body });
      toast(`Question sent to @${user.handle}.`);
      onClose(true);
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={`Ask @${user.handle}`} onClose={() => onClose(false)}>
      <form className="stack" onSubmit={submit}>
        <Field as="textarea" label="Your question" rows={4} maxLength={LIMITS.question} value={body} onChange={(e) => setBody(e.target.value)} autoFocus
          hint={`${body.length}/${LIMITS.question}`} />
        <p className="muted small">
          {user.displayName} will not see who asked. If they answer, the question and answer appear publicly on their profile.
          Moderators can identify the sender of a question that is reported for abuse.
        </p>
        <ErrorNote error={error} />
        <div className="row row-end">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="solid" type="submit" busy={busy} disabled={!body.trim()}>Ask anonymously</Button>
        </div>
      </form>
    </Modal>
  );
}

export const openProfile = (user) => navigate(`/u/${user.handle}`);
