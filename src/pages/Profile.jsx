import { useState } from 'react';
import { post as send, patch, del } from '../api.js';
import { useApp } from '../state.jsx';
import { Link, navigate } from '../router.jsx';
import { Icon } from '../icons.jsx';
import { Avatar, Button, Check, Confirm, Empty, ErrorNote, Field, Menu, Modal, RichText, Spinner, Tabs, UserRow, useLoad, usePaged } from '../ui.jsx';
import { AskDialog, BlockDialog, FollowButton, PostCard, ReportDialog } from '../components/Post.jsx';
import { FeedList } from './Feed.jsx';
import { LIMITS } from '../../shared/constants.js';
import { backgroundStyle } from '../background.jsx';

/** The player only loads from the music service after the visitor asks for it. */
function MusicPlayer({ music }) {
  const [open, setOpen] = useState(false);
  if (!music) return null;
  return (
    <div className="music">
      {!open ? (
        <button type="button" className="music-button" onClick={() => setOpen(true)}>
          ♫ Play this profile’s music <span className="muted">on {music.provider}</span>
        </button>
      ) : (
        <iframe
          className={`music-frame music-${music.provider.toLowerCase().replace(/\s/g, '-')}`} src={music.embed} title={`Music player from ${music.provider}`} loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" allow="encrypted-media" referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}

function PeopleDialog({ handle, kind, onClose }) {
  const { data, error, loading } = useLoad(`/api/users/${handle}/${kind}`);
  return (
    <Modal title={kind === 'followers' ? 'Followers' : 'Following'} onClose={onClose}>
      {loading && <Spinner />}
      <ErrorNote error={error} />
      {data?.items.length === 0 && <p className="muted">{kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p>}
      <div className="user-list" onClick={(e) => { if (e.target.closest('a')) onClose(); }}>
        {data?.items.map((u) => <UserRow key={u.handle} user={u}><FollowButton user={u} /></UserRow>)}
      </div>
    </Modal>
  );
}

function BoardPreview({ board }) {
  const cells = [...board.preview, null, null, null, null].slice(0, 4);
  return (
    <Link className="board-card" to={`/board/${board.id}`}>
      <div className="board-mosaic" aria-hidden="true">
        {cells.map((c, i) => (
          <div key={i} className="board-cell">{c?.image ? <img src={c.image} alt="" loading="lazy" /> : c?.text ? <span>{c.text}</span> : null}</div>
        ))}
      </div>
      <h3>{board.name}</h3>
      <p className="muted small">{board.count} {board.count === 1 ? 'post' : 'posts'}{board.isPrivate && <> <Icon name="lock" size={13} label="Private" /> Private</>}</p>
    </Link>
  );
}

function Boards({ user }) {
  const { data, error, loading, reload } = useLoad(`/api/users/${user.handle}/boards`);
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    try { await send('/api/boards', { name, isPrivate }); setName(''); setIsPrivate(false); reload(); } catch (err) { setFormError(err); }
    setBusy(false);
  };

  return (
    <div>
      {user.isMe && (
        <form className="board-new" onSubmit={create}>
          <Field label="New board" placeholder="Board name" maxLength={LIMITS.boardName} value={name} onChange={(e) => setName(e.target.value)} error={formError?.message} />
          <Check checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)}>Private</Check>
          <Button variant="solid" type="submit" busy={busy} disabled={!name.trim()}>Create board</Button>
        </form>
      )}
      {loading && !data && <Spinner />}
      <ErrorNote error={error} retry={reload} />
      {data?.items.length === 0 && (
        <Empty title={user.isMe ? 'No boards yet' : `${user.displayName} has no public boards`}>
          {user.isMe && <p>Boards collect posts you want to keep. Create one above, then use Save on any post.</p>}
        </Empty>
      )}
      <div className="board-grid">{data?.items.map((b) => <BoardPreview key={b.id} board={b} />)}</div>
    </div>
  );
}

export function Profile({ handle, tab }) {
  const { toast } = useApp();
  const { data: user, error, loading, reload, setData } = useLoad(`/api/users/${handle}`);
  const [dialog, setDialog] = useState(null);
  const current = tab === 'boards' ? 'boards' : 'feed';
  const feed = usePaged(`/api/users/${handle}/feed`);

  if (loading && !user) return <Spinner />;
  if (error) {
    return error.status === 404
      ? <Empty title="This account is not available">The username may be wrong, or the account may have been removed.<p><Link to="/">Back to Explore</Link></p></Empty>
      : <ErrorNote error={error} retry={reload} />;
  }

  return (
    <section className="profile">
      <div className="cover" style={backgroundStyle(user.background)} />
      <div className="profile-top">
        <Avatar user={user} size="xl" />
        <div className="profile-actions">
          {user.isMe ? <Button onClick={() => navigate('/settings')}>Edit profile</Button> : (
            <>
              <FollowButton user={user} onChange={(following) => setData((u) => ({ ...u, following, counts: { ...u.counts, followers: u.counts.followers + (following ? 1 : -1) } }))} />
              {user.canMessage && <Button className="btn-small" onClick={() => navigate(`/messages/${user.handle}`)}>Message</Button>}
              {user.allowQuestions && <Button className="btn-small" onClick={() => setDialog('ask')}>Ask anonymously</Button>}
              <Menu label="Profile options" items={[
                { label: 'Report account', onSelect: () => setDialog('report') },
                { label: `Block @${user.handle}`, danger: true, onSelect: () => setDialog('block') },
              ]} />
            </>
          )}
        </div>
      </div>
      <h2 className="profile-name">{user.displayName}</h2>
      <p className="muted">@{user.handle}{user.followsYou && <span className="follows-you">Follows you</span>}</p>
      {user.bio ? <RichText text={user.bio} className="profile-bio" /> : user.isMe && <p className="muted profile-bio">Add a bio in <Link to="/settings">settings</Link> to tell people what this space is about.</p>}
      <p className="profile-counts">
        <button type="button" className="link-btn" onClick={() => setDialog('followers')}><strong>{user.counts.followers}</strong> {user.counts.followers === 1 ? 'follower' : 'followers'}</button>
        <button type="button" className="link-btn" onClick={() => setDialog('following')}><strong>{user.counts.following}</strong> following</button>
        <span><strong>{user.counts.posts}</strong> {user.counts.posts === 1 ? 'post' : 'posts'}</span>
      </p>
      {user.interests.length > 0 && <p className="post-tags">{user.interests.map((t) => <Link key={t} className="tag" to={`/?tag=${t}`}>{t}</Link>)}</p>}
      <MusicPlayer music={user.music} />

      <Tabs label="Profile sections" value={current} onChange={(t) => navigate(t === 'feed' ? `/u/${handle}` : `/u/${handle}/boards`, { replace: true })}
        tabs={[['feed', 'Feed'], ['boards', 'Boards']]} />
      {current === 'feed'
        ? <FeedList list={feed} empty={<Empty title={user.isMe ? 'You have not posted yet' : 'Nothing here yet'}>{user.isMe && <Button variant="solid" onClick={() => navigate('/create')}>Write a post</Button>}</Empty>} />
        : <Boards user={user} />}

      {(dialog === 'followers' || dialog === 'following') && <PeopleDialog handle={handle} kind={dialog} onClose={() => setDialog(null)} />}
      {dialog === 'ask' && <AskDialog user={user} onClose={() => setDialog(null)} />}
      {dialog === 'report' && <ReportDialog targetType="user" targetId={user.handle} handle={user.handle} onClose={() => setDialog(null)} onBlocked={() => navigate('/')} />}
      {dialog === 'block' && <BlockDialog handle={user.handle} onClose={() => setDialog(null)} onDone={() => { toast(`You can unblock @${user.handle} in settings.`); navigate('/'); }} />}
    </section>
  );
}

export function BoardPage({ id }) {
  const { toast } = useApp();
  const { data, error, loading, reload, setData } = useLoad(`/api/boards/${id}`);
  const [dialog, setDialog] = useState(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState(null);

  if (loading && !data) return <Spinner />;
  if (error) {
    return error.status === 404
      ? <Empty title="This board is not available">It may be private or deleted.<p><Link to="/">Back to Explore</Link></p></Empty>
      : <ErrorNote error={error} retry={reload} />;
  }
  const { board, items } = data;

  const update = async (change) => {
    try { const res = await patch(`/api/boards/${board.id}`, change); setData((d) => ({ ...d, board: { ...d.board, ...res.board } })); return true; }
    catch (err) { setFormError(err); return false; }
  };
  const unsave = async (postId) => {
    try { await del(`/api/boards/${board.id}/items/${postId}`); setData((d) => ({ ...d, items: d.items.filter((p) => p.id !== postId) })); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <section>
      <p className="back"><Link to={`/u/${board.owner.handle}/boards`}>{board.mine ? 'Your boards' : `${board.owner.displayName}’s boards`}</Link></p>
      <header className="page-head">
        <div>
          <h2 className="page-title">{board.name}</h2>
          <p className="muted">{items.length} {items.length === 1 ? 'post' : 'posts'}, {board.isPrivate ? 'private (only you can see it)' : 'public'}</p>
        </div>
        {board.mine && (
          <Menu label="Board options" items={[
            { label: 'Rename', onSelect: () => { setName(board.name); setFormError(null); setDialog('rename'); } },
            { label: board.isPrivate ? 'Make public' : 'Make private', onSelect: () => update({ isPrivate: !board.isPrivate }) },
            { label: 'Delete board', danger: true, onSelect: () => setDialog('delete') },
          ]} />
        )}
      </header>
      {items.length === 0 && <Empty title="This board is empty">{board.mine && <p>Use Save on any post to add it here.</p>}</Empty>}
      <div className="board-items">
        {items.map((p) => (
          <div key={p.id} className="board-item">
            <PostCard post={p} />
            {board.mine && <Button variant="link" className="btn-small" onClick={() => unsave(p.id)}>Remove from board</Button>}
          </div>
        ))}
      </div>
      {dialog === 'rename' && (
        <Modal title="Rename board" onClose={() => setDialog(null)}>
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (await update({ name })) setDialog(null); }}>
            <Field label="Board name" maxLength={LIMITS.boardName} value={name} onChange={(e) => setName(e.target.value)} error={formError?.message} autoFocus />
            <div className="row row-end"><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="solid" type="submit" disabled={!name.trim()}>Save name</Button></div>
          </form>
        </Modal>
      )}
      {dialog === 'delete' && (
        <Confirm title={`Delete “${board.name}”?`} action="Delete board" danger onClose={() => setDialog(null)}
          onConfirm={async () => { await del(`/api/boards/${board.id}`); toast('Board deleted.'); navigate(`/u/${board.owner.handle}/boards`); }}>
          <p>The board is deleted. The posts saved on it are not.</p>
        </Confirm>
      )}
    </section>
  );
}
