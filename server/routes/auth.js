import fs from 'node:fs';
import path from 'node:path';
import { HttpError, bad, cleanEmail, cleanHandle, isReserved, integer } from '../http.js';
import {
  hashPassword, verifyPassword, passwordProblem, randomToken, sha256,
  newTotpSecret, verifyTotp, newRecoveryCodes,
} from '../security.js';
import { selfPayload, counts } from '../lib.js';

const MIN = 60_000;
const HOUR = 3600_000;

export default function authRoutes(app) {
  const { router: r, db, config } = app;

  const sessionReply = (ctx, user, csrf) => ({ user: selfPayload(user), csrf, counts: counts(app, user) });

  /** Re-check the password before a sensitive change. */
  async function confirmPassword(ctx, password) {
    app.limit(`confirm:${ctx.me.id}`, 10, 15 * MIN);
    if (typeof password !== 'string' || !(await verifyPassword(password, ctx.me.password_hash))) {
      throw new HttpError(403, 'That password is not right.', { field: 'password' });
    }
  }

  function endOtherSessions(userId, keepSessionId = null) {
    db.run('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?', [userId, keepSessionId]);
    if (keepSessionId === null) app.realtime.drop(userId);
  }

  r.get('/api/session', (ctx) => {
    if (!ctx.session) return { user: null };
    return sessionReply(ctx, ctx.me, ctx.session.csrf);
  }, { auth: false });

  r.get('/api/auth/handle-available', (ctx) => {
    let handle;
    try { handle = cleanHandle(ctx.query.get('handle')); } catch (err) { return { available: false, reason: err.message }; }
    if (isReserved(handle) || db.get('SELECT 1 x FROM users WHERE handle = ?', [handle])) {
      return { available: false, reason: 'That username is taken.' };
    }
    return { available: true };
  }, { auth: false, limit: ['handle-check', 60, MIN] });

  r.post('/api/auth/signup', async (ctx) => {
    const b = ctx.body;
    const handle = cleanHandle(b.handle);
    const email = cleanEmail(b.email);
    if (b.ageConfirmed !== true) throw bad('You need to be 13 or older to join.', 'ageConfirmed');
    if (b.acceptedGuidelines !== true) throw bad('Agree to the community guidelines to join.', 'acceptedGuidelines');
    const problem = passwordProblem(b.password, { handle, email });
    if (problem) throw bad(problem, 'password');
    if (isReserved(handle) || db.get('SELECT 1 x FROM users WHERE handle = ?', [handle])) throw bad('That username is taken.', 'handle');
    if (db.get('SELECT 1 x FROM users WHERE email = ?', [email])) throw bad('An account already uses that email. Sign in instead.', 'email');

    const hash = await hashPassword(b.password, config.scryptN);
    let id;
    try {
      id = db.run('INSERT INTO users (handle, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        [handle, email, handle, hash, Date.now()]).lastInsertRowid;
    } catch { throw bad('That username is taken.', 'handle'); }
    const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
    ctx.status = 201;
    return sessionReply(ctx, user, app.startSession(ctx, user.id));
  }, { auth: false, limit: ['signup', 5, HOUR] });

  r.post('/api/auth/login', async (ctx) => {
    const identifier = String(ctx.body.identifier ?? '').trim().toLowerCase().replace(/^@/, '').slice(0, 254);
    const password = ctx.body.password;
    if (!identifier || typeof password !== 'string' || !password) throw bad('Enter your username or email, and your password.');
    if (password.length > 200) throw new HttpError(401, 'That username or password is not right.');

    const user = identifier.includes('@')
      ? db.get('SELECT * FROM users WHERE email = ?', [identifier])
      : db.get('SELECT * FROM users WHERE handle = ?', [identifier]);

    // Lock-outs apply the same way whether or not the account exists, so they reveal nothing.
    const subject = user ? `id${user.id}` : `name:${identifier}`;
    const pairKey = `login-fail:${subject}:${ctx.ip}`;
    const accountKey = `login-fail:${subject}`;
    const wait = Math.max(app.limiter.blockedFor(pairKey, 5, 15 * MIN), app.limiter.blockedFor(accountKey, 25, HOUR));
    if (wait) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes, or reset your password.`, { retryAfter: wait });

    const ok = await verifyPassword(password, user ? user.password_hash : app.dummyHash) && !!user;
    if (!ok) {
      app.limiter.record(pairKey);
      app.limiter.record(accountKey);
      throw new HttpError(401, 'That username or password is not right.');
    }
    if (user.suspended_at) throw new HttpError(403, 'This account has been suspended for breaking the community guidelines.');
    app.limiter.clear(pairKey);

    if (user.totp_enabled) {
      const ticket = randomToken();
      app.pendingTwoFactor.set(ticket, { userId: user.id, expires: Date.now() + 5 * MIN, tries: 0 });
      return { twoFactor: true, ticket };
    }
    return sessionReply(ctx, user, app.startSession(ctx, user.id));
  }, { auth: false, limit: ['login', 30, 10 * MIN] });

  r.post('/api/auth/two-factor', (ctx) => {
    const pending = app.pendingTwoFactor.get(String(ctx.body.ticket || ''));
    if (!pending || pending.expires < Date.now()) throw new HttpError(401, 'That sign-in attempt expired. Start again.', { restart: true });
    if (++pending.tries > 5) {
      app.pendingTwoFactor.delete(ctx.body.ticket);
      throw new HttpError(401, 'Too many wrong codes. Sign in again.', { restart: true });
    }
    const user = db.get('SELECT * FROM users WHERE id = ?', [pending.userId]);
    const code = String(ctx.body.code || '').trim().toLowerCase();
    let ok = false;
    if (/^\d{6}$/.test(code.replace(/\s/g, ''))) {
      const step = verifyTotp(user.totp_secret, code, user.totp_last_step);
      if (step) { db.run('UPDATE users SET totp_last_step = ? WHERE id = ?', [step, user.id]); ok = true; }
    } else if (code) {
      const hashes = JSON.parse(user.recovery_codes);
      const i = hashes.indexOf(sha256(code));
      if (i >= 0) {
        hashes.splice(i, 1); // each recovery code works once
        db.run('UPDATE users SET recovery_codes = ? WHERE id = ?', [JSON.stringify(hashes), user.id]);
        ok = true;
      }
    }
    if (!ok) throw new HttpError(401, 'That code is not right. Check your authenticator app and try again.', { field: 'code' });
    app.pendingTwoFactor.delete(ctx.body.ticket);
    return sessionReply(ctx, user, app.startSession(ctx, user.id));
  }, { auth: false, limit: ['two-factor', 20, 10 * MIN] });

  r.post('/api/auth/logout', (ctx) => {
    db.run('DELETE FROM sessions WHERE id = ?', [ctx.session.id]);
    app.clearCookie(ctx);
  });

  r.post('/api/auth/forgot', (ctx) => {
    let email = null;
    try { email = cleanEmail(ctx.body.email); } catch { throw bad('Enter the email address you signed up with.', 'email'); }
    const user = db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (user && !user.suspended_at) {
      // Never build the link from the Host header in production; that can be forged.
      const origin = config.publicOrigin || (config.production ? '' : `http://${ctx.req.headers.host}`);
      if (!origin) console.error('[auth] Password reset requested but PUBLIC_ORIGIN is not set, so no email was sent.');
      else {
        const token = randomToken();
        db.run('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
        db.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha256(token), user.id, Date.now() + 30 * MIN]);
        app.mailer.send({
          to: user.email,
          subject: 'Reset your Anonymous password',
          body: `Someone asked to reset the password for @${user.handle}.\n\nChoose a new password here (the link works once, for 30 minutes):\n${origin}/reset?token=${token}\n\nIf this was not you, ignore this email. Your password has not changed.`,
        }).catch((err) => console.error('[mail]', err.message));
      }
    }
    return { ok: true }; // same answer whether or not the address has an account
  }, { auth: false, limit: ['forgot', 5, HOUR] });

  r.post('/api/auth/reset', async (ctx) => {
    const row = db.get('SELECT * FROM password_resets WHERE token_hash = ?', [sha256(String(ctx.body.token || ''))]);
    if (!row || row.used_at || row.expires_at < Date.now()) {
      throw new HttpError(400, 'That reset link has expired or was already used. Ask for a new one.', { expired: true });
    }
    const user = db.get('SELECT * FROM users WHERE id = ?', [row.user_id]);
    const problem = passwordProblem(ctx.body.password, user);
    if (problem) throw bad(problem, 'password');
    const hash = await hashPassword(ctx.body.password, config.scryptN);
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
      db.run('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', [Date.now(), row.token_hash]);
    });
    endOtherSessions(user.id);
    app.limiter.clear(`login-fail:id${user.id}`);
    return { ok: true };
  }, { auth: false, limit: ['reset', 10, HOUR] });

  /* ---------- signed-in account management ---------- */

  r.post('/api/account/password', async (ctx) => {
    await confirmPassword(ctx, ctx.body.current);
    const problem = passwordProblem(ctx.body.next, ctx.me);
    if (problem) throw bad(problem, 'next');
    if (ctx.body.next === ctx.body.current) throw bad('Choose a password you have not just used.', 'next');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(ctx.body.next, config.scryptN), ctx.me.id]);
    endOtherSessions(ctx.me.id, ctx.session.id);
  });

  r.post('/api/account/email', async (ctx) => {
    await confirmPassword(ctx, ctx.body.password);
    const email = cleanEmail(ctx.body.email);
    if (db.get('SELECT 1 x FROM users WHERE email = ? AND id <> ?', [email, ctx.me.id])) throw bad('An account already uses that email.', 'email');
    db.run('UPDATE users SET email = ? WHERE id = ?', [email, ctx.me.id]);
    db.run('DELETE FROM password_resets WHERE user_id = ?', [ctx.me.id]);
    return { email };
  });

  r.get('/api/account/sessions', (ctx) => ({
    items: db.all('SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC', [ctx.me.id])
      .map((s) => ({ id: s.id, userAgent: s.user_agent, ip: s.ip, createdAt: s.created_at, lastSeenAt: s.last_seen_at, current: s.id === ctx.session.id })),
  }));

  r.delete('/api/account/sessions/:id', (ctx) => {
    const id = integer(ctx.params.id);
    if (id === ctx.session.id) throw bad('Use Sign out to end this session.');
    db.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', [id, ctx.me.id]);
  });

  r.post('/api/account/sessions/end-others', (ctx) => { endOtherSessions(ctx.me.id, ctx.session.id); });

  r.post('/api/account/two-factor/setup', async (ctx) => {
    await confirmPassword(ctx, ctx.body.password);
    if (ctx.me.totp_enabled) throw bad('Two-step sign-in is already on.');
    const secret = newTotpSecret();
    db.run('UPDATE users SET totp_secret = ?, totp_last_step = 0 WHERE id = ?', [secret, ctx.me.id]);
    return { secret, uri: `otpauth://totp/Anonymous:${ctx.me.handle}?secret=${secret}&issuer=Anonymous&digits=6&period=30` };
  });

  r.post('/api/account/two-factor/enable', (ctx) => {
    if (ctx.me.totp_enabled || !ctx.me.totp_secret) throw bad('Start setting up two-step sign-in first.');
    app.limit(`totp-enable:${ctx.me.id}`, 10, 10 * MIN);
    const step = verifyTotp(ctx.me.totp_secret, ctx.body.code, 0);
    if (!step) throw bad('That code is not right. Enter the current 6-digit code from your app.', 'code');
    const codes = newRecoveryCodes();
    db.run('UPDATE users SET totp_enabled = 1, totp_last_step = ?, recovery_codes = ? WHERE id = ?',
      [step, JSON.stringify(codes.map(sha256)), ctx.me.id]);
    endOtherSessions(ctx.me.id, ctx.session.id);
    return { recoveryCodes: codes };
  });

  r.post('/api/account/two-factor/disable', async (ctx) => {
    await confirmPassword(ctx, ctx.body.password);
    db.run("UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0, recovery_codes = '[]' WHERE id = ?", [ctx.me.id]);
  });

  r.get('/api/account/export', (ctx) => {
    const id = ctx.me.id;
    const handleOf = 'SELECT handle FROM users WHERE id =';
    return {
      exportedAt: new Date().toISOString(),
      account: selfPayload(ctx.me),
      posts: db.all('SELECT id, body, image, tags, created_at FROM posts WHERE author_id = ? AND deleted_at IS NULL', [id]),
      comments: db.all('SELECT id, post_id, parent_id, body, created_at FROM comments WHERE author_id = ? AND deleted_at IS NULL', [id]),
      likedPostIds: db.all('SELECT post_id FROM likes WHERE user_id = ?', [id]).map((x) => x.post_id),
      repostedPostIds: db.all('SELECT post_id FROM reposts WHERE user_id = ?', [id]).map((x) => x.post_id),
      boards: db.all('SELECT id, name, is_private, created_at FROM boards WHERE owner_id = ?', [id])
        .map((b) => ({ ...b, postIds: db.all('SELECT post_id FROM board_items WHERE board_id = ?', [b.id]).map((x) => x.post_id) })),
      following: db.all(`SELECT (${handleOf} followee_id) handle FROM follows WHERE follower_id = ?`, [id]).map((x) => x.handle),
      followers: db.all(`SELECT (${handleOf} follower_id) handle FROM follows WHERE followee_id = ?`, [id]).map((x) => x.handle),
      blocked: db.all(`SELECT (${handleOf} blocked_id) handle FROM blocks WHERE blocker_id = ?`, [id]).map((x) => x.handle),
      questionsReceived: db.all('SELECT body, answer, created_at, answered_at FROM questions WHERE recipient_id = ? AND deleted_at IS NULL', [id]),
      questionsAsked: db.all(`SELECT (${handleOf} recipient_id) asked, body, created_at FROM questions WHERE sender_id = ?`, [id]),
      messages: db.all(`SELECT (${handleOf} sender_id) "from", (${handleOf} recipient_id) "to", body, created_at FROM messages WHERE sender_id = ? OR recipient_id = ? ORDER BY created_at`, [id, id]),
    };
  }, { limit: ['export', 5, HOUR] });

  r.post('/api/account/delete', async (ctx) => {
    await confirmPassword(ctx, ctx.body.password);
    const files = db.all('SELECT name FROM uploads WHERE owner_id = ?', [ctx.me.id]);
    db.run('DELETE FROM users WHERE id = ?', [ctx.me.id]); // everything else cascades
    for (const f of files) fs.rm(path.join(app.uploadsDir, f.name), { force: true }, () => {});
    app.realtime.drop(ctx.me.id);
    app.clearCookie(ctx);
  });
}
