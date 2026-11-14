import { useMemo, useState } from 'react';
import { post as send, del } from '../api.js';
import { useApp } from '../state.jsx';
import { Link, navigate } from '../router.jsx';
import { Avatar, Button, Empty, ErrorNote, Menu, RichText, Spinner, Time, useLoad } from '../ui.jsx';
import { PostCard, ReportDialog } from '../components/Post.jsx';
import { LIMITS } from '../../shared/constants.js';

function CommentForm({ postId, parentId = null, onDone, onCancel, autoFocus = false }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await send(`/api/posts/${postId}/comments`, { body, parentId }); setBody(''); onDone(); }
    catch (err) { setError(err); }
    setBusy(false);
  };
  return (
    <form className="comment-form" onSubmit={submit}>
      <label className="sr-only" htmlFor={`comment-${parentId ?? 'new'}`}>{parentId ? 'Your reply' : 'Your comment'}</label>
      <textarea id={`comment-${parentId ?? 'new'}`} rows={parentId ? 2 : 3} maxLength={LIMITS.comment} placeholder={parentId ? 'Write a reply…' : 'Add a comment…'}
        value={body} onChange={(e) => setBody(e.target.value)} autoFocus={autoFocus} />
      <ErrorNote error={error} />
      <div className="row row-end">
        {onCancel && <Button className="btn-small" onClick={onCancel}>Cancel</Button>}
        <Button variant="solid" className="btn-small" type="submit" busy={busy} disabled={!body.trim()}>{parentId ? 'Reply' : 'Comment'}</Button>
      </div>
    </form>
  );
}

function Comment({ comment, children, depth, postId, reload }) {
  const { toast } = useApp();
  const [replying, setReplying] = useState(false);
  const [reporting, setReporting] = useState(false);
  const remove = async () => {
    try { await del(`/api/comments/${comment.id}`); reload(); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <li className="comment">
      {comment.removed ? <p className="muted comment-removed">This comment was removed.</p> : (
        <>
          <header className="comment-head">
            <Link className="post-author" to={`/u/${comment.author.handle}`}>
              <Avatar user={comment.author} size="sm" />
              <span><span className="post-name">{comment.author.displayName}</span> <span className="muted">@{comment.author.handle}</span></span>
            </Link>
            <span className="muted post-time"><Time at={comment.createdAt} /></span>
            <Menu label="Comment options" items={[
              comment.canRemove && { label: comment.mine ? 'Delete comment' : 'Remove comment', danger: true, onSelect: remove },
              !comment.mine && { label: 'Report comment', onSelect: () => setReporting(true) },
            ]} />
          </header>
          <RichText text={comment.body} className="comment-body" />
          {!replying && <Button variant="link" className="btn-small" onClick={() => setReplying(true)}>Reply</Button>}
          {replying && <CommentForm postId={postId} parentId={comment.id} autoFocus onCancel={() => setReplying(false)} onDone={() => { setReplying(false); reload(); }} />}
          {reporting && <ReportDialog targetType="comment" targetId={comment.id} handle={comment.author.handle} onClose={() => setReporting(false)} onBlocked={reload} />}
        </>
      )}
      {children.length > 0 && (
        <ul className={depth < 3 ? 'plain-list comments comments-indent' : 'plain-list comments'}>
          {children.map((c) => <Comment key={c.comment.id} {...c} depth={depth + 1} postId={postId} reload={reload} />)}
        </ul>
      )}
    </li>
  );
}

export default function PostPage({ id }) {
  const { data, error, loading, reload } = useLoad(`/api/posts/${id}`);

  const tree = useMemo(() => {
    if (!data) return [];
    const nodes = new Map(data.comments.map((c) => [c.id, { comment: c, children: [] }]));
    const roots = [];
    for (const node of nodes.values()) {
      const parent = node.comment.parentId && nodes.get(node.comment.parentId);
      (parent ? parent.children : roots).push(node);
    }
    return roots;
  }, [data]);

  if (loading && !data) return <Spinner />;
  if (error) {
    return error.status === 404
      ? <Empty title="This post is not available">It may have been deleted.<p><Link to="/">Back to Explore</Link></p></Empty>
      : <ErrorNote error={error} retry={reload} />;
  }

  return (
    <section>
      <p className="back"><Button variant="link" onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/'))}>Back</Button></p>
      <PostCard key={`${data.post.id}-${data.post.commentCount}`} post={data.post} full onRemoved={() => navigate('/')} />
      <h2 className="section-title">Comments</h2>
      <CommentForm postId={data.post.id} onDone={reload} />
      {tree.length === 0
        ? <p className="muted">No comments yet.</p>
        : <ul className="plain-list comments comments-root">{tree.map((c) => <Comment key={c.comment.id} {...c} depth={1} postId={data.post.id} reload={reload} />)}</ul>}
    </section>
  );
}
