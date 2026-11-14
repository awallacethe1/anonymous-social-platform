import { forbidden, text, integer } from '../http.js';
import { LIMITS } from '../config.js';
import { visibleUser, publicUser, canMessage, isBlockedBetween, now } from '../lib.js';

const MIN = 60_000;

export default function messageRoutes(app) {
  const { router: r, db } = app;

  const payload = (m, meId) => ({ id: m.id, body: m.body, createdAt: m.created_at, mine: m.sender_id === meId, read: !!m.read_at });

  r.get('/api/conversations', (ctx) => {
    const me = ctx.me.id;
    const partners = db.all(`
      SELECT partner, MAX(created_at) AS at FROM (
        SELECT CASE WHEN sender_id = :me THEN recipient_id ELSE sender_id END AS partner, created_at
        FROM messages WHERE sender_id = :me OR recipient_id = :me
      ) GROUP BY partner ORDER BY at DESC LIMIT 100`, { me });
    const items = [];
    for (const p of partners) {
      const u = db.get('SELECT * FROM users WHERE id = ?', [p.partner]);
      if (!u || u.suspended_at || isBlockedBetween(db, me, u.id)) continue;
      const last = db.get('SELECT * FROM messages WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?) ORDER BY id DESC LIMIT 1', [me, u.id, u.id, me]);
      items.push({
        user: publicUser(u),
        last: payload(last, me),
        unread: db.get('SELECT COUNT(*) c FROM messages WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL', [u.id, me]).c,
      });
    }
    return { items };
  });

  r.get('/api/conversations/:handle', (ctx) => {
    const me = ctx.me.id;
    const u = visibleUser(app, ctx.me, ctx.params.handle);
    const before = ctx.query.get('before') ? integer(ctx.query.get('before')) : Number.MAX_SAFE_INTEGER;
    const rows = db.all(`SELECT * FROM messages WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)) AND id < ?
      ORDER BY id DESC LIMIT 51`, [me, u.id, u.id, me, before]);
    const marked = db.run('UPDATE messages SET read_at = ? WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL', [now(), u.id, me]);
    if (marked.changes) {
      app.realtime.send(me, 'counts');
      app.realtime.send(u.id, 'read', { by: ctx.me.handle });
    }
    return {
      user: publicUser(u),
      canMessage: canMessage(db, ctx.me, u),
      hasMore: rows.length > 50,
      messages: rows.slice(0, 50).reverse().map((m) => payload(m, me)),
    };
  });

  r.post('/api/conversations/:handle', (ctx) => {
    const me = ctx.me.id;
    const u = visibleUser(app, ctx.me, ctx.params.handle);
    if (!canMessage(db, ctx.me, u)) throw forbidden('This person is not accepting messages from you.');
    const body = text(ctx.body.body, { name: 'Your message', max: LIMITS.message, min: 1 });
    const known = db.get('SELECT 1 x FROM messages WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?) LIMIT 1', [me, u.id, u.id, me]);
    if (!known) app.limit(`new-conversation:${me}`, 10, 60 * MIN); // slows down unsolicited mass messaging
    const t = now();
    const id = Number(db.run('INSERT INTO messages (sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?)', [me, u.id, body, t]).lastInsertRowid);
    const message = { id, body, createdAt: t, read: false };
    app.realtime.send(u.id, 'message', { with: ctx.me.handle, message: { ...message, mine: false } });
    app.realtime.send(me, 'message', { with: u.handle, message: { ...message, mine: true } });
    ctx.status = 201;
    return { message: { ...message, mine: true } };
  }, { limit: ['message', 40, MIN] });
}
