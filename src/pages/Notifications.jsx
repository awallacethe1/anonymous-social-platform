import { useEffect } from 'react';
import { post as send } from '../api.js';
import { useApp, useLive } from '../state.jsx';
import { Link } from '../router.jsx';
import { Icon } from '../icons.jsx';
import { Avatar, Empty, ErrorNote, Spinner, Time, useLoad } from '../ui.jsx';

const KINDS = {
  follow: { icon: 'user', text: 'followed you', to: (n) => `/u/${n.actor.handle}` },
  like: { icon: 'heart', text: 'liked your post', to: (n) => `/post/${n.postId}` },
  comment: { icon: 'comment', text: 'commented on your post', to: (n) => `/post/${n.postId}` },
  reply: { icon: 'comment', text: 'replied in a thread', to: (n) => `/post/${n.postId}` },
  repost: { icon: 'repost', text: 'reposted your post', to: (n) => `/post/${n.postId}` },
  question: { icon: 'question', text: 'Someone asked you a question', to: () => '/questions' },
  answer: { icon: 'question', text: 'answered your question', to: () => '/questions/asked' },
};

export default function Notifications() {
  const { refreshCounts } = useApp();
  const { data, error, loading, reload } = useLoad('/api/notifications');
  useLive('notification', reload);

  // Opening the page counts as reading them.
  const unread = data?.items.some((n) => !n.read);
  useEffect(() => { if (unread) send('/api/notifications/read').then(refreshCounts, () => {}); }, [unread, refreshCounts]);

  return (
    <section>
      <header className="page-head"><h2 className="page-title">Notifications</h2></header>
      {loading && !data && <Spinner />}
      <ErrorNote error={error} retry={reload} />
      {data?.items.length === 0 && <Empty title="Nothing new">Likes, comments, reposts, new followers and questions show up here.</Empty>}
      <ul className="plain-list">
        {data?.items.map((n) => {
          const kind = KINDS[n.type];
          if (!kind || (!n.actor && n.type !== 'question')) return null;
          return (
            <li key={n.id}>
              <Link className={n.read ? 'notice' : 'notice notice-new'} to={kind.to(n)}>
                {n.actor ? <Avatar user={n.actor} /> : <span className="avatar avatar-md avatar-blank" aria-hidden="true"><Icon name={kind.icon} size={18} /></span>}
                <span className="notice-text">
                  <span>{n.actor && <strong>{n.actor.displayName} </strong>}{kind.text}{!n.read && <span className="sr-only"> (new)</span>}</span>
                  {n.excerpt && <span className="muted notice-excerpt">{n.excerpt}</span>}
                </span>
                <span className="muted small"><Time at={n.createdAt} /></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
