import { bad, text, escapeLike } from '../http.js';
import { INTERESTS, LIMITS } from '../config.js';
import {
  visibleUser, publicUser, selfPayload, parseMusic, cleanBackground, readBackground, canMessage, notify, notBlocked, counts,
  loadPosts, loadAnswers, ownUpload, paging, page, now,
} from '../lib.js';

const MIN = 60_000;

export default function userRoutes(app) {
  const { router: r, db } = app;

  const listUsers = (me, sql, params) => db.all(`
    SELECT u.handle, u.display_name, u.avatar, u.bio, u.id,
           EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :me AND f.followee_id = u.id) AS following
    FROM users u WHERE u.suspended_at IS NULL AND ${notBlocked('u.id')} AND ${sql}`, { me: me.id, ...params })
    .map((u) => ({ ...publicUser(u), bio: u.bio, following: !!u.following, isMe: u.id === me.id }));
  app.listUsers = listUsers;

  r.get('/api/counts', (ctx) => counts(app, ctx.me));

  r.get('/api/events', (ctx) => { app.realtime.open(ctx.me.id, ctx.req, ctx.res); });

  r.get('/api/users/:handle', (ctx) => {
    const u = visibleUser(app, ctx.me, ctx.params.handle);
    const one = (sql, p) => db.get(sql, p).c;
    return {
      ...publicUser(u),
      bio: u.bio,
      background: readBackground(u.background),
      music: parseMusic(u.music_url),
      interests: JSON.parse(u.interests),
      createdAt: u.created_at,
      counts: {
        followers: one('SELECT COUNT(*) c FROM follows f JOIN users x ON x.id = f.follower_id WHERE f.followee_id = ? AND x.suspended_at IS NULL', [u.id]),
        following: one('SELECT COUNT(*) c FROM follows f JOIN users x ON x.id = f.followee_id WHERE f.follower_id = ? AND x.suspended_at IS NULL', [u.id]),
        posts: one('SELECT COUNT(*) c FROM posts WHERE author_id = ? AND deleted_at IS NULL', [u.id]),
      },
      isMe: u.id === ctx.me.id,
      following: !!db.get('SELECT 1 x FROM follows WHERE follower_id = ? AND followee_id = ?', [ctx.me.id, u.id]),
      followsYou: !!db.get('SELECT 1 x FROM follows WHERE follower_id = ? AND followee_id = ?', [u.id, ctx.me.id]),
      allowQuestions: !!u.allow_questions,
      canMessage: canMessage(db, ctx.me, u),
    };
  });

  r.patch('/api/profile', (ctx) => {
    const b = ctx.body;
    const set = {};
    if ('displayName' in b) set.display_name = text(b.displayName, { name: 'Name', max: LIMITS.displayName, multiline: false }) || ctx.me.handle;
    if ('bio' in b) set.bio = text(b.bio, { name: 'Bio', max: LIMITS.bio });
    if ('background' in b) set.background = cleanBackground(app, ctx.me, b.background, 'Profile background');
    if ('appBackground' in b) set.app_background = cleanBackground(app, ctx.me, b.appBackground, 'App background');
    if ('avatar' in b) set.avatar = ownUpload(app, ctx.me, b.avatar, 'Photo');
    if ('musicUrl' in b) {
      const raw = String(b.musicUrl ?? '').trim();
      if (!raw) set.music_url = null;
      else {
        const music = parseMusic(raw);
        if (!music) throw bad('Paste a link to a track, album or playlist on Spotify, Apple Music, SoundCloud or YouTube.', 'musicUrl');
        set.music_url = music.url;
      }
    }
    if ('interests' in b) {
      if (!Array.isArray(b.interests) || b.interests.some((i) => !INTERESTS.includes(i))) throw bad('Choose interests from the list.', 'interests');
      set.interests = JSON.stringify([...new Set(b.interests)]);
    }
    if ('dmPolicy' in b) {
      if (!['everyone', 'following', 'none'].includes(b.dmPolicy)) throw bad('Choose who can message you.', 'dmPolicy');
      set.dm_policy = b.dmPolicy;
    }
    if ('allowQuestions' in b) set.allow_questions = b.allowQuestions ? 1 : 0;
    if (b.onboarded === true) set.onboarded = 1;

    const cols = Object.keys(set);
    if (cols.length) db.run(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => set[c]), ctx.me.id]);
    return { user: selfPayload(db.get('SELECT * FROM users WHERE id = ?', [ctx.me.id])) };
  }, { limit: ['profile', 30, 10 * MIN] });

  r.post('/api/users/:handle/follow', (ctx) => {
    const u = visibleUser(app, ctx.me, ctx.params.handle);
    if (u.id === ctx.me.id) throw bad('You cannot follow yourself.');
    const res = db.run('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', [ctx.me.id, u.id, now()]);
    if (res.changes) notify(app, { userId: u.id, actorId: ctx.me.id, type: 'follow' });
    return { following: true };
  }, { limit: ['follow', 120, 10 * MIN] });

  r.delete('/api/users/:handle/follow', (ctx) => {
    const u = visibleUser(app, ctx.me, ctx.params.handle);
    db.run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', [ctx.me.id, u.id]);
    return { following: false };
  });

  r.get('/api/users/:handle/followers', (ctx) => {
    const u = visibleUser(app, ctx.me, ctx.params.handle);
    return { items: listUsers(ctx.me, 'u.id IN (SELECT follower_id FROM follows WHERE followee_id = :id) ORDER BY u.handle LIMIT 500', { id: u.id }) };
  });

  r.get('/api/users/:handle/following', (ctx) => {
    const u = visibleUser(app, ctx.me, ctx.params.handle);
    return { items: listUsers(ctx.me, 'u.id IN (SELECT followee_id FROM follows WHERE follower_id = :id) ORDER BY u.handle LIMIT 500', { id: u.id }) };
  });

  /** People who share your interests and whom you do not follow yet. */
  r.get('/api/suggestions', (ctx) => ({
    items: listUsers(ctx.me, `u.id <> :me AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = :me)
      ORDER BY (SELECT COUNT(*) FROM json_each(u.interests) WHERE value IN (SELECT value FROM json_each(:mine))) DESC,
               (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) DESC, u.id DESC
      LIMIT 8`, { mine: ctx.me.interests }),
  }));

  /** Profile feed: original posts, reposts and public answers, newest first. */
  r.get('/api/users/:handle/feed', (ctx) => {
    const u = visibleUser(app, ctx.me, ctx.params.handle);
    const pg = paging(ctx.query, 20);
    const rows = db.all(`
      SELECT 'post' AS kind, id AS ref, created_at AS at FROM posts WHERE author_id = :u AND deleted_at IS NULL
      UNION ALL SELECT 'repost', post_id, created_at FROM reposts WHERE user_id = :u
      UNION ALL SELECT 'answer', id, answered_at FROM questions WHERE recipient_id = :u AND answered_at IS NOT NULL AND deleted_at IS NULL
      ORDER BY at DESC LIMIT :limit OFFSET :offset`, { u: u.id, limit: pg.limit + 1, offset: pg.offset });
    const posts = loadPosts(app, ctx.me, rows.filter((x) => x.kind !== 'answer').map((x) => x.ref));
    const answers = loadAnswers(app, ctx.me, rows.filter((x) => x.kind === 'answer').map((x) => x.ref));
    const items = rows.map((x) => {
      if (x.kind === 'answer') return answers.has(x.ref) && { type: 'answer', key: `a${x.ref}`, at: x.at, answer: answers.get(x.ref) };
      if (!posts.has(x.ref)) return null;
      return { type: 'post', key: `${x.kind[0]}${x.ref}`, at: x.at, post: posts.get(x.ref), repostedBy: x.kind === 'repost' ? publicUser(u) : null };
    });
    const out = page(items, pg);
    out.items = out.items.filter(Boolean);
    return out;
  });

  r.get('/api/search', (ctx) => {
    const q = text(ctx.query.get('q'), { name: 'Search', max: 80, multiline: false });
    if (q.length < 2) return { users: [], posts: [], answers: [] };
    const like = `%${escapeLike(q.replace(/^[@#]/, ''))}%`;
    const users = listUsers(ctx.me, "(u.handle LIKE :q ESCAPE '\\' OR u.display_name LIKE :q ESCAPE '\\') ORDER BY (u.handle = :exact) DESC, u.handle LIMIT 12",
      { q: like, exact: q.replace(/^@/, '').toLowerCase() });
    const postIds = db.all(`SELECT id FROM posts WHERE deleted_at IS NULL AND (body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 40`, [like, like]).map((x) => x.id);
    const posts = loadPosts(app, ctx.me, postIds);
    const answerIds = db.all(`SELECT id FROM questions WHERE answered_at IS NOT NULL AND deleted_at IS NULL AND (body LIKE ? ESCAPE '\\' OR answer LIKE ? ESCAPE '\\') ORDER BY answered_at DESC LIMIT 20`, [like, like]).map((x) => x.id);
    const answers = loadAnswers(app, ctx.me, answerIds);
    return {
      users,
      posts: postIds.filter((id) => posts.has(id)).map((id) => posts.get(id)),
      answers: answerIds.filter((id) => answers.has(id)).map((id) => answers.get(id)),
    };
  }, { limit: ['search', 60, MIN] });
}
