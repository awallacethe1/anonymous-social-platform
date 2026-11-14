import { HttpError, notFound } from './http.js';

export const now = () => Date.now();

export const publicUser = (row) => row && ({
  handle: row.handle,
  displayName: row.display_name || row.handle,
  avatar: row.avatar || null,
});

/** SQL fragment: true when neither side has blocked the other. Needs a :me parameter. */
export const notBlocked = (col) => `NOT EXISTS (SELECT 1 FROM blocks bl WHERE (bl.blocker_id = :me AND bl.blocked_id = ${col}) OR (bl.blocker_id = ${col} AND bl.blocked_id = :me))`;

export function isBlockedBetween(db, a, b) {
  return !!db.get('SELECT 1 x FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', [a, b, b, a]);
}

/** Look up a user another member is allowed to see. Blocked or suspended accounts look like they do not exist. */
export function visibleUser(app, me, handle) {
  const user = app.db.get('SELECT * FROM users WHERE handle = ?', [String(handle).replace(/^@/, '')]);
  if (!user || user.suspended_at) throw notFound('That account');
  if (user.id !== me.id && isBlockedBetween(app.db, me.id, user.id)) throw notFound('That account');
  return user;
}

/* ---------- music ---------- */

/** Accepts only links from services that provide their own licensed player. Returns { provider, url, embed } or null. */
export function parseMusic(input) {
  if (!input) return null;
  let url;
  try { url = new URL(String(input).trim()); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname;
  if (host === 'open.spotify.com') {
    const m = /^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]{10,40})$/.exec(path);
    if (m) return { provider: 'Spotify', url: `https://open.spotify.com/${m[1]}/${m[2]}`, embed: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
  }
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'm.youtube.com') {
    const id = url.searchParams.get('v');
    if (path === '/watch' && /^[\w-]{11}$/.test(id || '')) return { provider: 'YouTube', url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === 'youtu.be') {
    const id = path.slice(1);
    if (/^[\w-]{11}$/.test(id)) return { provider: 'YouTube', url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === 'soundcloud.com') {
    if (/^\/[\w-]+\/(?:sets\/)?[\w-]+$/.test(path)) {
      const clean = `https://soundcloud.com${path}`;
      return { provider: 'SoundCloud', url: clean, embed: `https://w.soundcloud.com/player/?url=${encodeURIComponent(clean)}&visual=false&show_comments=false` };
    }
  }
  if (host === 'music.apple.com') {
    if (/^\/[a-z]{2}\/(album|playlist|song)\/[^/]+\/[\w.]+$/.test(path)) {
      const track = url.searchParams.get('i');
      const q = track && /^\d+$/.test(track) ? `?i=${track}` : '';
      return { provider: 'Apple Music', url: `https://music.apple.com${path}${q}`, embed: `https://embed.music.apple.com${path}${q}` };
    }
  }
  return null;
}

/* ---------- backgrounds ---------- */

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Validate a background chosen in settings. Only structured values are accepted (never raw CSS),
 * so a background cannot smuggle in a url() to another site or break out of the style.
 * Returns a JSON string to store, or null for "use the default".
 */
export function cleanBackground(app, me, value, name = 'Background') {
  if (value === null || value === undefined || value === '') return null;
  const fail = () => new HttpError(400, `${name}: choose a color, a gradient or an uploaded image.`, { field: 'background' });
  if (typeof value !== 'object' || Array.isArray(value)) throw fail();
  if (value.type === 'color' && HEX.test(value.color || '')) return JSON.stringify({ type: 'color', color: value.color.toLowerCase() });
  if (value.type === 'gradient' && HEX.test(value.from || '') && HEX.test(value.to || '')) {
    const angle = Number.isFinite(Number(value.angle)) ? Math.round(Math.min(360, Math.max(0, Number(value.angle)))) : 135;
    return JSON.stringify({ type: 'gradient', from: value.from.toLowerCase(), to: value.to.toLowerCase(), angle });
  }
  if (value.type === 'image') {
    // fit: "cover" fills the space with one copy (full screen); "tile" repeats the picture at `size` pixels wide.
    const fit = value.fit === 'tile' ? 'tile' : 'cover';
    const size = Number.isFinite(Number(value.size)) ? Math.round(Math.min(800, Math.max(40, Number(value.size)))) : 240;
    return JSON.stringify({ type: 'image', url: ownUpload(app, me, value.url, name), fit, ...(fit === 'tile' ? { size } : {}) });
  }
  throw fail();
}

export const readBackground = (stored) => { try { return stored ? JSON.parse(stored) : null; } catch { return null; } };

/* ---------- account payloads ---------- */

export const selfPayload = (u) => ({
  handle: u.handle,
  displayName: u.display_name || u.handle,
  email: u.email,
  avatar: u.avatar || null,
  bio: u.bio,
  background: readBackground(u.background),
  appBackground: readBackground(u.app_background),
  music: parseMusic(u.music_url),
  interests: JSON.parse(u.interests),
  dmPolicy: u.dm_policy,
  allowQuestions: !!u.allow_questions,
  onboarded: !!u.onboarded,
  role: u.role,
  twoFactor: !!u.totp_enabled,
  createdAt: u.created_at,
});

export function canMessage(db, sender, recipient) {
  if (recipient.suspended_at || sender.id === recipient.id) return false;
  if (isBlockedBetween(db, sender.id, recipient.id)) return false;
  if (recipient.dm_policy === 'none') return false;
  if (recipient.dm_policy === 'following') {
    return !!db.get('SELECT 1 x FROM follows WHERE follower_id = ? AND followee_id = ?', [recipient.id, sender.id]);
  }
  return true;
}

/* ---------- posts ---------- */

const POST_SELECT = `
  SELECT p.id, p.body, p.image, p.tags, p.created_at, p.author_id,
         u.handle, u.display_name, u.avatar,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
         (SELECT COUNT(*) FROM reposts r WHERE r.post_id = p.id) AS repost_count,
         EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = :me) AS liked,
         EXISTS (SELECT 1 FROM reposts r WHERE r.post_id = p.id AND r.user_id = :me) AS reposted,
         EXISTS (SELECT 1 FROM board_items bi JOIN boards b ON b.id = bi.board_id WHERE bi.post_id = p.id AND b.owner_id = :me) AS saved
  FROM posts p JOIN users u ON u.id = p.author_id
  WHERE p.deleted_at IS NULL AND u.suspended_at IS NULL AND ${notBlocked('p.author_id')}`;

const postPayload = (r, me) => ({
  id: r.id,
  body: r.body,
  image: r.image || null,
  tags: JSON.parse(r.tags),
  createdAt: r.created_at,
  author: publicUser(r),
  likeCount: r.like_count,
  commentCount: r.comment_count,
  repostCount: r.repost_count,
  liked: !!r.liked,
  reposted: !!r.reposted,
  saved: !!r.saved,
  mine: r.author_id === me.id,
});

/** Load posts the viewer may see, keyed by id. Hidden, deleted and blocked posts are simply absent. */
export function loadPosts(app, me, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const rows = app.db.all(`${POST_SELECT} AND p.id IN (SELECT value FROM json_each(:ids))`, { me: me.id, ids: JSON.stringify(ids) });
  for (const r of rows) map.set(r.id, postPayload(r, me));
  return map;
}

export function loadPost(app, me, id) {
  const post = loadPosts(app, me, [id]).get(id);
  if (!post) throw notFound('That post');
  return post;
}

/* ---------- answers (public side of anonymous questions) ---------- */

const ANSWER_SELECT = `
  SELECT q.id, q.body, q.answer, q.answered_at, q.recipient_id, u.handle, u.display_name, u.avatar
  FROM questions q JOIN users u ON u.id = q.recipient_id
  WHERE q.answered_at IS NOT NULL AND q.deleted_at IS NULL AND u.suspended_at IS NULL AND ${notBlocked('q.recipient_id')}`;

// Deliberately has no sender and no asked-at time.
const answerPayload = (r, me) => ({
  id: r.id,
  question: r.body,
  answer: r.answer,
  answeredAt: r.answered_at,
  by: publicUser(r),
  mine: r.recipient_id === me.id,
});

export function loadAnswers(app, me, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const rows = app.db.all(`${ANSWER_SELECT} AND q.id IN (SELECT value FROM json_each(:ids))`, { me: me.id, ids: JSON.stringify(ids) });
  for (const r of rows) map.set(r.id, answerPayload(r, me));
  return map;
}

/* ---------- notifications ---------- */

export function notify(app, { userId, actorId = null, type, postId = null, questionId = null }) {
  if (userId === actorId) return;
  if (actorId && isBlockedBetween(app.db, userId, actorId)) return;
  if (actorId) {
    // Liking, unliking and liking again should leave one notification, not three.
    app.db.run('DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND post_id IS ? AND question_id IS ?',
      [userId, actorId, type, postId, questionId]);
  }
  app.db.run('INSERT INTO notifications (user_id, actor_id, type, post_id, question_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, actorId, type, postId, questionId, now()]);
  app.realtime.send(userId, 'notification', { type });
}

export function counts(app, me) {
  const n = app.db.get(`SELECT COUNT(*) c FROM notifications n WHERE n.user_id = :me AND n.read_at IS NULL
    AND (n.actor_id IS NULL OR ${notBlocked('n.actor_id')})`, { me: me.id }).c;
  const m = app.db.get(`SELECT COUNT(*) c FROM messages m WHERE m.recipient_id = :me AND m.read_at IS NULL AND ${notBlocked('m.sender_id')}`, { me: me.id }).c;
  const q = app.db.get('SELECT COUNT(*) c FROM questions WHERE recipient_id = ? AND answered_at IS NULL AND deleted_at IS NULL', [me.id]).c;
  return { notifications: n, messages: m, questions: q };
}

/* ---------- uploads ---------- */

/** An image reference is only accepted if this user uploaded that file. */
export function ownUpload(app, me, value, name = 'Image') {
  if (value === null || value === undefined || value === '') return null;
  const m = /^\/uploads\/([a-f0-9]{32}\.(?:jpg|png|gif))$/.exec(String(value));
  if (!m || !app.db.get('SELECT 1 x FROM uploads WHERE name = ? AND owner_id = ?', [m[1], me.id])) {
    throw new HttpError(400, `${name} must be uploaded first.`);
  }
  return `/uploads/${m[1]}`;
}

export function paging(query, max = 30) {
  const offset = Math.max(0, Math.min(5000, Number.parseInt(query.get('offset') || '0', 10) || 0));
  const untilRaw = Number(query.get('until'));
  const until = Number.isFinite(untilRaw) && untilRaw > 0 ? untilRaw : now();
  return { offset, until, limit: max };
}

export const page = (items, { offset, until, limit }) => ({
  items: items.slice(0, limit),
  next: items.length > limit ? { offset: offset + limit, until } : null,
});
