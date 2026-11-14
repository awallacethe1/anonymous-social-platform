import { useEffect, useState } from 'react';
import { useApp } from '../state.jsx';
import { Link, navigate } from '../router.jsx';
import { Icon } from '../icons.jsx';
import { Button, Empty, ErrorNote, LoadMore, Spinner, UserRow, useLoad, usePaged } from '../ui.jsx';
import { AnswerCard, FeedItem, FollowButton, PostCard } from '../components/Post.jsx';
import { INTERESTS } from '../../shared/constants.js';

function SearchBox({ initial = '' }) {
  const [q, setQ] = useState(initial);
  useEffect(() => setQ(initial), [initial]);
  const submit = (e) => {
    e.preventDefault();
    const term = q.trim();
    navigate(term ? `/search?q=${encodeURIComponent(term)}` : '/');
  };
  return (
    <form className="search" role="search" onSubmit={submit}>
      <Icon name="search" size={18} />
      <input type="search" aria-label="Search posts, people and answers" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
    </form>
  );
}

function TopicBar({ base, tag }) {
  const to = (t) => (t ? `${base}?tag=${t}` : base);
  return (
    <nav className="topics" aria-label="Topics">
      <Link className={!tag ? 'chip chip-on' : 'chip'} to={to(null)} aria-current={!tag ? 'true' : undefined}>All</Link>
      {INTERESTS.map((t) => <Link key={t} className={tag === t ? 'chip chip-on' : 'chip'} to={to(t)} aria-current={tag === t ? 'true' : undefined}>{t}</Link>)}
    </nav>
  );
}

export function Explore({ query }) {
  const { me } = useApp();
  const tag = INTERESTS.includes(query.get('tag')) ? query.get('tag') : null;
  const list = usePaged(`/api/feed?scope=explore${tag ? `&tag=${tag}` : ''}`);
  return (
    <section>
      <header className="page-head">
        <h2 className="page-title">Explore</h2>
        <SearchBox />
      </header>
      <TopicBar base="/" tag={tag} />
      {!tag && me.interests.length > 0 && <p className="muted small lede">Posts about {me.interests.slice(0, 3).join(', ')}{me.interests.length > 3 ? ' and your other interests' : ''} and from people you follow come first.</p>}
      <FeedList list={list} empty={
        <Empty title={tag ? `Nothing about ${tag} yet` : 'Nothing has been posted yet'}>
          <p>Be the first.</p>
          <Button variant="solid" onClick={() => navigate('/create')}>Write a post</Button>
        </Empty>
      } />
    </section>
  );
}

export function Following({ query }) {
  const tag = INTERESTS.includes(query.get('tag')) ? query.get('tag') : null;
  const list = usePaged(`/api/feed?scope=following${tag ? `&tag=${tag}` : ''}`);
  return (
    <section>
      <header className="page-head"><h2 className="page-title">Following</h2></header>
      <TopicBar base="/following" tag={tag} />
      <FeedList list={list} empty={<><Empty title="Your Following page is quiet">Posts and reposts from people you follow appear here, newest first.</Empty><Suggestions /></>} />
    </section>
  );
}

function Suggestions() {
  const { data } = useLoad('/api/suggestions');
  if (!data?.items.length) return null;
  return (
    <section className="panel">
      <h2>People you might like</h2>
      <div className="user-list">{data.items.map((u) => <UserRow key={u.handle} user={u}><FollowButton user={u} /></UserRow>)}</div>
    </section>
  );
}

export function FeedList({ list, empty }) {
  const drop = (id) => list.setItems((items) => items.filter((i) => (i.post?.id ?? i.answer?.id) !== id));
  return (
    <div aria-busy={list.loading}>
      {list.loading && !list.items.length && <Spinner />}
      <ErrorNote error={list.error} retry={list.reload} />
      {!list.loading && !list.error && !list.items.length && empty}
      {list.items.map((item) => <FeedItem key={item.key} item={item} onRemoved={drop} />)}
      <LoadMore list={list} />
    </div>
  );
}

export function Search({ query }) {
  const q = (query.get('q') || '').trim();
  const { data, error, loading, reload } = useLoad(q.length >= 2 ? `/api/search?q=${encodeURIComponent(q)}` : null);
  const nothing = data && !data.users.length && !data.posts.length && !data.answers.length;
  return (
    <section>
      <header className="page-head">
        <h2 className="page-title">Search</h2>
        <SearchBox initial={q} />
      </header>
      {q.length < 2 && <Empty title="Search Anonymous">Type at least two characters to find posts, people and answers.</Empty>}
      {loading && <Spinner label="Searching" />}
      <ErrorNote error={error} retry={reload} />
      {nothing && <Empty title={`No results for “${q}”`}>Check the spelling, or try a shorter word.</Empty>}
      {data?.users.length > 0 && (
        <section className="panel">
          <h2>People</h2>
          <div className="user-list">{data.users.map((u) => <UserRow key={u.handle} user={u}><FollowButton user={u} /></UserRow>)}</div>
        </section>
      )}
      {data?.posts.length > 0 && <><h2 className="section-title">Posts</h2>{data.posts.map((p) => <PostCard key={p.id} post={p} />)}</>}
      {data?.answers.length > 0 && <><h2 className="section-title">Answers</h2>{data.answers.map((a) => <AnswerCard key={a.id} answer={a} />)}</>}
    </section>
  );
}
