import { bad, forbidden, notFound, text, integer } from '../http.js';
import { INTERESTS, LIMITS } from '../config.js';
import { loadPost, loadPosts, publicUser, notify, isBlockedBetween, ownUpload, paging, page, now } from '../lib.js';

const MIN = 60_000;
const HOUR = 3600_000;

export default function postRoutes(app) {
  const { router: r, db } = app;

  /**
   * Explore puts posts from people you follow and posts tagged with your interests ahead of
   * everything else, then falls back to newest first. Following is strictly chronological
   * and includes reposts by the people you follow.
   */
  r.get('/api/feed', (ctx) => {
    const pg = paging(ctx.query, 20);
    const tag = INTERESTS.includes(ctx.query.get('tag')) ? ctx.query.get('tag') : null;
    const tagFilter = tag ? 'AND EXISTS (SELECT 1 FROM post_tags t WHERE t.post_id = p.id AND t.tag = :tag)' : '';
    const params = { me: ctx.me.id, until: pg.until, limit: pg.limit + 1, offset: pg.offset, ...(tag ? { tag } : {}) };
    let rows;

    if (ctx.query.get('scope') === 'following') {
      rows = db.all(`
        WITH mine AS (SELECT followee_id AS id FROM follows WHERE follower_id = :me),
        items AS (
          SELECT p.id AS post_id, p.created_at AS at, NULL AS reposter_id FROM posts p
            WHERE p.deleted_at IS NULL AND (p.author_id = :me OR p.author_id IN (SELECT id FROM mine)) ${tagFilter}
          UNION ALL
          SELECT r.post_id, r.created_at, r.user_id FROM reposts r JOIN posts p ON p.id = r.post_id
            WHERE p.deleted_at IS NULL AND r.user_id IN (SELECT id FROM mine) ${tagFilter}
        )
        SELECT post_id, MAX(at) AS at, reposter_id FROM items WHERE at <= :until
        GROUP BY post_id ORDER BY at DESC, post_id DESC LIMIT :limit OFFSET :offset`, params);
    } else {
      rows = db.all(`
        SELECT p.id AS post_id, p.created_at AS at, NULL AS reposter_id,
               p.created_at
               + CASE WHEN EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :me AND f.followee_id = p.author_id) THEN 43200000 ELSE 0 END
               + 21600000 * MIN(2, (SELECT COUNT(*) FROM post_tags t WHERE t.post_id = p.id AND t.tag IN (SELECT value FROM json_each(:interests)))) AS score
        FROM posts p WHERE p.deleted_at IS NULL AND p.created_at <= :until ${tagFilter}
        ORDER BY score DESC, p.id DESC LIMIT :limit OFFSET :offset`, { ...params, interests: ctx.me.interests });
    }

    const posts = loadPosts(app, ctx.me, rows.map((x) => x.post_id));
    const reposters = new Map();
    for (const x of rows) {
      if (x.reposter_id && !reposters.has(x.reposter_id) && !isBlockedBetween(db, ctx.me.id, x.reposter_id)) {
        reposters.set(x.reposter_id, publicUser(db.get('SELECT handle, display_name, avatar FROM users WHERE id = ? AND suspended_at IS NULL', [x.reposter_id])));
      }
    }
    const out = page(rows.map((x) => posts.has(x.post_id) && {
      type: 'post', key: `p${x.post_id}`, at: x.at, post: posts.get(x.post_id), repostedBy: reposters.get(x.reposter_id) || null,
    }), pg);
    out.items = out.items.filter(Boolean);
    return out;
  });

  r.post('/api/posts', (ctx) => {
    const image = ownUpload(app, ctx.me, ctx.body.image);
    const body = text(ctx.body.body, { name: 'Your post', max: LIMITS.post });
    if (!body && !image) throw bad('Write something or attach an image.', 'body');
    const tags = ctx.body.tags ?? [];
    if (!Array.isArray(tags) || tags.some((t) => !INTERESTS.includes(t))) throw bad('Choose topics from the list.', 'tags');
    const unique = [...new Set(tags)];
    if (unique.length > LIMITS.tagsPerPost) throw bad(`Choose up to ${LIMITS.tagsPerPost} topics.`, 'tags');
    const last = db.get('SELECT body, created_at FROM posts WHERE author_id = ? ORDER BY id DESC LIMIT 1', [ctx.me.id]);
    if (last && body && last.body === body && now() - last.created_at < 5 * MIN) throw bad('You just posted that.');

    const id = db.tx(() => {
      const pid = db.run('INSERT INTO posts (author_id, body, image, tags, created_at) VALUES (?, ?, ?, ?, ?)',
        [ctx.me.id, body, image, JSON.stringify(unique), now()]).lastInsertRowid;
      for (const t of unique) db.run('INSERT INTO post_tags (post_id, tag) VALUES (?, ?)', [pid, t]);
      return Number(pid);
    });
    ctx.status = 201;
    return { post: loadPost(app, ctx.me, id) };
  }, { limit: ['post', 30, HOUR] });

  r.get('/api/posts/:id', (ctx) => {
    const post = loadPost(app, ctx.me, integer(ctx.params.id));
    const postAuthor = db.get('SELECT author_id FROM posts WHERE id = ?', [post.id]).author_id;
    const rows = db.all(`
      SELECT c.id, c.parent_id, c.body, c.created_at, c.deleted_at, c.author_id, u.handle, u.display_name, u.avatar, u.suspended_at,
             EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :me AND b.blocked_id = c.author_id) OR (b.blocker_id = c.author_id AND b.blocked_id = :me)) AS blocked
      FROM comments c JOIN users u ON u.id = c.author_id WHERE c.post_id = :post ORDER BY c.created_at, c.id`, { me: ctx.me.id, post: post.id });
    const comments = rows.map((c) => {
      const hidden = !!(c.deleted_at || c.blocked || c.suspended_at);
      return {
        id: c.id, parentId: c.parent_id, createdAt: c.created_at, removed: hidden,
        body: hidden ? null : c.body,
        author: hidden ? null : publicUser(c),
        mine: !hidden && c.author_id === ctx.me.id,
        canRemove: !hidden && (c.author_id === ctx.me.id || postAuthor === ctx.me.id),
      };
    });
    // Removed comments stay only while something replies to them.
    const hasVisibleReply = (id) => comments.some((c) => c.parentId === id && (!c.removed || hasVisibleReply(c.id)));
    return { post, comments: comments.filter((c) => !c.removed || hasVisibleReply(c.id)) };
  });

  r.delete('/api/posts/:id', (ctx) => {
    const id = integer(ctx.params.id);
    const row = db.get('SELECT author_id FROM posts WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) throw notFound('That post');
    if (row.author_id !== ctx.me.id) throw forbidden('You can only delete your own posts.');
    db.run('UPDATE posts SET deleted_at = ? WHERE id = ?', [now(), id]);
    db.run('DELETE FROM notifications WHERE post_id = ?', [id]);
  });

  const engagement = (table, type) => {
    r.post(`/api/posts/:id/${type}`, (ctx) => {
      const post = loadPost(app, ctx.me, integer(ctx.params.id));
      if (type === 'repost' && post.mine) throw bad('You cannot repost your own post.');
      const res = db.run(`INSERT OR IGNORE INTO ${table} (user_id, post_id, created_at) VALUES (?, ?, ?)`, [ctx.me.id, post.id, now()]);
      if (res.changes) {
        const author = db.get('SELECT author_id FROM posts WHERE id = ?', [post.id]).author_id;
        notify(app, { userId: author, actorId: ctx.me.id, type, postId: post.id });
      }
      return { post: loadPost(app, ctx.me, post.id) };
    }, { limit: [type, 200, 10 * MIN] });

    r.delete(`/api/posts/:id/${type}`, (ctx) => {
      const post = loadPost(app, ctx.me, integer(ctx.params.id));
      db.run(`DELETE FROM ${table} WHERE user_id = ? AND post_id = ?`, [ctx.me.id, post.id]);
      return { post: loadPost(app, ctx.me, post.id) };
    });
  };
  engagement('likes', 'like');
  engagement('reposts', 'repost');

  r.post('/api/posts/:id/comments', (ctx) => {
    const post = loadPost(app, ctx.me, integer(ctx.params.id));
    const body = text(ctx.body.body, { name: 'Your comment', max: LIMITS.comment, min: 1 });
    let parent = null;
    if (ctx.body.parentId != null) {
      parent = db.get('SELECT id, author_id FROM comments WHERE id = ? AND post_id = ? AND deleted_at IS NULL', [integer(ctx.body.parentId), post.id]);
      if (!parent || isBlockedBetween(db, ctx.me.id, parent.author_id)) throw notFound('The comment you are replying to');
    }
    const id = Number(db.run('INSERT INTO comments (post_id, author_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
      [post.id, ctx.me.id, parent?.id ?? null, body, now()]).lastInsertRowid);
    const postAuthor = db.get('SELECT author_id FROM posts WHERE id = ?', [post.id]).author_id;
    if (parent && parent.author_id !== postAuthor) notify(app, { userId: parent.author_id, actorId: ctx.me.id, type: 'reply', postId: post.id });
    notify(app, { userId: postAuthor, actorId: ctx.me.id, type: parent ? 'reply' : 'comment', postId: post.id });
    ctx.status = 201;
    return { id };
  }, { limit: ['comment', 60, 10 * MIN] });

  r.delete('/api/comments/:id', (ctx) => {
    const id = integer(ctx.params.id);
    const row = db.get('SELECT c.author_id, p.author_id AS post_author FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ? AND c.deleted_at IS NULL', [id]);
    if (!row) throw notFound('That comment');
    if (row.author_id !== ctx.me.id && row.post_author !== ctx.me.id) throw forbidden('You can only remove your own comments, or comments on your posts.');
    db.run('UPDATE comments SET deleted_at = ? WHERE id = ?', [now(), id]);
  });
}
