import { HttpError, bad, notFound, text, integer } from '../http.js';
import { REPORT_REASONS, LIMITS } from '../config.js';
import { publicUser, notBlocked, now } from '../lib.js';

const HOUR = 3600_000;
const REASONS = REPORT_REASONS.map(([key]) => key);

export default function safetyRoutes(app) {
  const { router: r, db } = app;

  const anyUser = (handle) => {
    const u = db.get('SELECT * FROM users WHERE handle = ?', [String(handle).replace(/^@/, '')]);
    if (!u) throw notFound('That account');
    return u;
  };

  /* ---------- blocking ---------- */

  r.post('/api/users/:handle/block', (ctx) => {
    const u = anyUser(ctx.params.handle);
    if (u.id === ctx.me.id) throw bad('You cannot block yourself.');
    db.tx(() => {
      db.run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)', [ctx.me.id, u.id, now()]);
      db.run('DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)', [ctx.me.id, u.id, u.id, ctx.me.id]);
    });
    app.realtime.send(ctx.me.id, 'counts');
  }, { limit: ['block', 60, HOUR] });

  r.delete('/api/users/:handle/block', (ctx) => {
    db.run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', [ctx.me.id, anyUser(ctx.params.handle).id]);
  });

  r.get('/api/blocks', (ctx) => ({
    items: db.all('SELECT u.handle, u.display_name, u.avatar FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC', [ctx.me.id]).map(publicUser),
  }));

  /* ---------- notifications ---------- */

  r.get('/api/notifications', (ctx) => {
    const rows = db.all(`
      SELECT n.id, n.type, n.created_at, n.read_at, n.post_id, n.question_id,
             u.handle, u.display_name, u.avatar, p.body AS post_body, q.body AS question_body
      FROM notifications n
      LEFT JOIN users u ON u.id = n.actor_id
      LEFT JOIN posts p ON p.id = n.post_id
      LEFT JOIN questions q ON q.id = n.question_id
      WHERE n.user_id = :me AND (n.actor_id IS NULL OR (u.suspended_at IS NULL AND ${notBlocked('n.actor_id')}))
        AND (n.post_id IS NULL OR p.deleted_at IS NULL) AND (n.question_id IS NULL OR q.deleted_at IS NULL)
      ORDER BY n.created_at DESC, n.id DESC LIMIT 80`, { me: ctx.me.id });
    return {
      items: rows.map((n) => ({
        id: n.id, type: n.type, createdAt: n.created_at, read: !!n.read_at,
        actor: n.handle ? publicUser(n) : null,
        postId: n.post_id, questionId: n.question_id,
        excerpt: (n.post_body ?? n.question_body ?? '').slice(0, 120),
      })),
    };
  });

  r.post('/api/notifications/read', (ctx) => {
    db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [now(), ctx.me.id]);
    app.realtime.send(ctx.me.id, 'counts');
  });

  /* ---------- reporting ---------- */

  r.post('/api/reports', (ctx) => {
    const { targetType, reason } = ctx.body;
    if (!REASONS.includes(reason)) throw bad('Choose a reason.', 'reason');
    const details = text(ctx.body.details, { name: 'Details', max: LIMITS.reportDetails });
    let targetId;
    // You can only report things you are able to see.
    if (targetType === 'user') {
      targetId = anyUser(ctx.body.targetId).id;
      if (targetId === ctx.me.id) throw bad('You cannot report yourself.');
    } else {
      targetId = integer(ctx.body.targetId);
      const found = {
        post: () => db.get('SELECT 1 x FROM posts WHERE id = ? AND deleted_at IS NULL', [targetId]),
        comment: () => db.get('SELECT 1 x FROM comments WHERE id = ? AND deleted_at IS NULL', [targetId]),
        question: () => db.get('SELECT 1 x FROM questions WHERE id = ? AND deleted_at IS NULL AND (recipient_id = ? OR answered_at IS NOT NULL)', [targetId, ctx.me.id]),
        message: () => db.get('SELECT 1 x FROM messages WHERE id = ? AND recipient_id = ?', [targetId, ctx.me.id]),
      }[targetType];
      if (!found) throw bad('That cannot be reported.');
      if (!found()) throw notFound('What you are reporting');
    }
    if (!db.get("SELECT 1 x FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'", [ctx.me.id, targetType, targetId])) {
      db.run('INSERT INTO reports (reporter_id, target_type, target_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [ctx.me.id, targetType, targetId, reason, details, now()]);
    }
    ctx.status = 201;
  }, { limit: ['report', 20, HOUR] });

  /* ---------- moderation (admins only; these routes answer 404 to everyone else) ---------- */

  /** What a report is about and who is responsible for it. Moderators can see who sent an anonymous question. */
  function subject(report) {
    const id = report.target_id;
    const row = {
      post: () => db.get('SELECT author_id AS user_id, body, image, deleted_at FROM posts WHERE id = ?', [id]),
      comment: () => db.get('SELECT author_id AS user_id, body, deleted_at FROM comments WHERE id = ?', [id]),
      question: () => db.get("SELECT sender_id AS user_id, body || CASE WHEN answer IS NOT NULL THEN char(10) || '— answered: ' || answer ELSE '' END AS body, deleted_at FROM questions WHERE id = ?", [id]),
      message: () => db.get('SELECT sender_id AS user_id, body FROM messages WHERE id = ?', [id]),
      user: () => db.get('SELECT id AS user_id, bio AS body, avatar AS image FROM users WHERE id = ?', [id]),
    }[report.target_type]();
    const user = row?.user_id ? db.get('SELECT * FROM users WHERE id = ?', [row.user_id]) : null;
    return { row, user };
  }

  r.get('/api/admin/reports', (ctx) => {
    const status = ctx.query.get('status') === 'resolved' ? 'resolved' : 'open';
    const rows = db.all(`SELECT rp.*, u.handle AS reporter FROM reports rp LEFT JOIN users u ON u.id = rp.reporter_id
      WHERE rp.status = ? ORDER BY rp.created_at DESC LIMIT 200`, [status]);
    return {
      items: rows.map((rp) => {
        const { row, user } = subject(rp);
        return {
          id: rp.id, targetType: rp.target_type, reason: rp.reason, details: rp.details, createdAt: rp.created_at,
          status: rp.status, resolution: rp.resolution, reporter: rp.reporter,
          content: row ? { body: row.body || '', image: row.image || null, removed: !!row.deleted_at } : null,
          account: user ? { handle: user.handle, suspended: !!user.suspended_at, isAdmin: user.role === 'admin' } : null,
        };
      }),
    };
  }, { admin: true });

  r.post('/api/admin/reports/:id/resolve', (ctx) => {
    const report = db.get("SELECT * FROM reports WHERE id = ? AND status = 'open'", [integer(ctx.params.id)]);
    if (!report) throw notFound('That report');
    const { action } = ctx.body;
    if (!['dismiss', 'remove', 'suspend'].includes(action)) throw bad('Choose what to do with this report.');
    const { user } = subject(report);
    const t = now();

    if (action === 'remove' || action === 'suspend') {
      const id = report.target_id;
      ({
        post: () => db.run('UPDATE posts SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [t, id]),
        comment: () => db.run('UPDATE comments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [t, id]),
        question: () => db.run('UPDATE questions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [t, id]),
        message: () => db.run('DELETE FROM messages WHERE id = ?', [id]),
        user: () => {},
      })[report.target_type]();
    }
    if (action === 'suspend') {
      if (!user) throw bad('The account behind this no longer exists.');
      if (user.role === 'admin') throw new HttpError(403, 'Moderators cannot be suspended from here.');
      db.run('UPDATE users SET suspended_at = ? WHERE id = ?', [t, user.id]);
      db.run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
      app.realtime.drop(user.id);
    }
    // Every open report about the same thing is closed together.
    db.run("UPDATE reports SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE target_type = ? AND target_id = ? AND status = 'open'",
      [action, ctx.me.id, t, report.target_type, report.target_id]);
  }, { admin: true });

  r.get('/api/admin/suspended', () => ({
    items: db.all('SELECT handle, display_name, avatar, suspended_at FROM users WHERE suspended_at IS NOT NULL ORDER BY suspended_at DESC LIMIT 200')
      .map((u) => ({ ...publicUser(u), suspendedAt: u.suspended_at })),
  }), { admin: true });

  r.post('/api/admin/users/:handle/reinstate', (ctx) => {
    db.run('UPDATE users SET suspended_at = NULL WHERE id = ?', [anyUser(ctx.params.handle).id]);
  }, { admin: true });
}
