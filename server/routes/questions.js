import { bad, forbidden, notFound, text, integer } from '../http.js';
import { LIMITS } from '../config.js';
import { visibleUser, publicUser, loadAnswers, notify, paging, page, now, notBlocked } from '../lib.js';

const HOUR = 3600_000;

/**
 * Anonymous questions.
 * The sender's id is stored so that limits, blocks and moderation still work, but no route
 * in this file ever puts it (or anything derived from it) into a response for the recipient.
 */
export default function questionRoutes(app) {
  const { router: r, db } = app;

  function received(ctx) {
    const q = db.get('SELECT * FROM questions WHERE id = ? AND deleted_at IS NULL', [integer(ctx.params.id)]);
    if (!q || q.recipient_id !== ctx.me.id) throw notFound('That question');
    return q;
  }

  r.post('/api/users/:handle/questions', (ctx) => {
    const to = visibleUser(app, ctx.me, ctx.params.handle);
    if (to.id === ctx.me.id) throw bad('You cannot ask yourself a question.');
    if (!to.allow_questions) throw forbidden('This person is not taking anonymous questions.');
    const body = text(ctx.body.body, { name: 'Your question', max: LIMITS.question, min: 1 });
    app.limit(`ask:${ctx.me.id}`, 20, HOUR);
    app.limit(`ask:${ctx.me.id}:${to.id}`, 5, HOUR);
    if (db.get('SELECT COUNT(*) c FROM questions WHERE recipient_id = ? AND sender_id = ? AND answered_at IS NULL AND deleted_at IS NULL', [to.id, ctx.me.id]).c >= 10) {
      throw bad('You have several questions waiting with this person already.');
    }
    // If the recipient has silenced this sender, accept the question and quietly drop it.
    if (!db.get('SELECT 1 x FROM anon_blocks WHERE recipient_id = ? AND sender_id = ?', [to.id, ctx.me.id])) {
      const id = Number(db.run('INSERT INTO questions (recipient_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)', [to.id, ctx.me.id, body, now()]).lastInsertRowid);
      notify(app, { userId: to.id, type: 'question', questionId: id });
    }
    ctx.status = 201;
    return { ok: true };
  });

  r.get('/api/questions/inbox', (ctx) => ({
    items: db.all('SELECT id, body, created_at FROM questions WHERE recipient_id = ? AND answered_at IS NULL AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200', [ctx.me.id])
      .map((q) => ({ id: q.id, body: q.body, createdAt: q.created_at })),
  }));

  /** Questions you asked. Only you can see this list. */
  r.get('/api/questions/sent', (ctx) => ({
    items: db.all(`SELECT q.id, q.body, q.created_at, q.answer, q.answered_at, q.deleted_at, u.handle, u.display_name, u.avatar
      FROM questions q JOIN users u ON u.id = q.recipient_id
      WHERE q.sender_id = :me AND u.suspended_at IS NULL AND ${notBlocked('q.recipient_id')} ORDER BY q.created_at DESC LIMIT 100`, { me: ctx.me.id })
      .map((q) => {
        const answered = !!q.answered_at && !q.deleted_at;
        return { id: q.id, body: q.body, createdAt: q.created_at, to: publicUser(q), answered, answer: answered ? q.answer : null };
      }),
  }));

  /** Public answers from everyone, newest first. */
  r.get('/api/questions/answers', (ctx) => {
    const pg = paging(ctx.query, 20);
    const ids = db.all('SELECT id FROM questions WHERE answered_at IS NOT NULL AND answered_at <= ? AND deleted_at IS NULL ORDER BY answered_at DESC, id DESC LIMIT ? OFFSET ?',
      [pg.until, pg.limit + 1, pg.offset]).map((x) => x.id);
    const answers = loadAnswers(app, ctx.me, ids);
    const out = page(ids.map((id) => answers.get(id) || null), pg);
    out.items = out.items.filter(Boolean);
    return out;
  });

  r.post('/api/questions/:id/answer', (ctx) => {
    const q = received(ctx);
    if (q.answered_at) throw bad('You already answered that question.');
    const answer = text(ctx.body.body, { name: 'Your answer', max: LIMITS.answer, min: 1 });
    db.run('UPDATE questions SET answer = ?, answered_at = ? WHERE id = ?', [answer, now(), q.id]);
    db.run("DELETE FROM notifications WHERE question_id = ? AND type = 'question'", [q.id]);
    if (q.sender_id) notify(app, { userId: q.sender_id, actorId: ctx.me.id, type: 'answer', questionId: q.id });
    return { answer: loadAnswers(app, ctx.me, [q.id]).get(q.id) };
  }, { limit: ['answer', 60, HOUR] });

  /** Remove a question you received, or take down an answer you gave. */
  r.delete('/api/questions/:id', (ctx) => {
    const q = received(ctx);
    db.run('UPDATE questions SET deleted_at = ? WHERE id = ?', [now(), q.id]);
    db.run('DELETE FROM notifications WHERE question_id = ?', [q.id]);
  });

  /** Stop hearing from whoever sent this question, without learning who it was. */
  r.post('/api/questions/:id/silence', (ctx) => {
    const q = received(ctx);
    if (q.sender_id) db.run('INSERT OR IGNORE INTO anon_blocks (recipient_id, sender_id, created_at) VALUES (?, ?, ?)', [ctx.me.id, q.sender_id, now()]);
    db.run('UPDATE questions SET deleted_at = ? WHERE id = ?', [now(), q.id]);
    db.run('DELETE FROM notifications WHERE question_id = ?', [q.id]);
  });
}
