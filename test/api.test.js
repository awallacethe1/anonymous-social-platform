import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { totpAt, totpStep } from '../server/security.js';

let s, ana, ben, cy;

before(async () => {
  s = await startServer();
  [ana, ben, cy] = [s.client(), s.client(), s.client()];
  await ana.signup('ana');
  await ben.signup('ben');
  await cy.signup('cy_');
});
after(() => s.stop());

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/* ---------- accounts and sign-in ---------- */

test('sign-up validates its input', async () => {
  const c = s.client();
  const base = { handle: 'dora', email: 'dora@example.test', password: PASSWORD, ageConfirmed: true, acceptedGuidelines: true };
  const cases = [
    [{ handle: 'no' }, 'handle'], [{ handle: 'bad name!' }, 'handle'], [{ handle: 'admin' }, 'handle'], [{ handle: 'ANA' }, 'handle'],
    [{ email: 'nope' }, 'email'], [{ email: 'ana@example.test' }, 'email'],
    [{ password: 'short' }, 'password'], [{ password: 'password123' }, 'password'], [{ password: 'i-am-dora-ok' }, 'password'],
    [{ ageConfirmed: false }, 'ageConfirmed'], [{ acceptedGuidelines: false }, 'acceptedGuidelines'],
  ];
  for (const [change, field] of cases) {
    const res = await c.post('/api/auth/signup', { ...base, ...change });
    assert.equal(res.status, 400, JSON.stringify(change));
    assert.equal(res.data.field, field, JSON.stringify(change));
  }
});

test('the session cookie is HttpOnly and SameSite, and passwords are stored hashed', async () => {
  assert.match(ana.lastSetCookie, /HttpOnly/);
  assert.match(ana.lastSetCookie, /SameSite=Lax/);
  const row = s.app.db.get("SELECT password_hash FROM users WHERE handle = 'ana'");
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes('battery'));
  const tokenInDb = s.app.db.get('SELECT token_hash FROM sessions LIMIT 1').token_hash;
  assert.ok(!ana.cookie.includes(tokenInDb), 'only a hash of the session token is stored');
});

test('signed-out visitors get 401 everywhere that matters', async () => {
  const c = s.client();
  for (const url of ['/api/feed', '/api/users/ana', '/api/conversations', '/api/notifications', '/api/account/export', '/api/admin/reports']) {
    assert.equal((await c.get(url)).status, 401, url);
  }
  assert.equal((await c.get('/api/session')).data.user, null);
});

test('writes need the CSRF token and must come from this site', async () => {
  const noToken = await ana.request('POST', '/api/posts', { body: 'hello' }, { 'X-CSRF-Token': 'wrong' });
  assert.equal(noToken.status, 403);
  const foreign = await ana.post('/api/posts', { body: 'hello' }, { Origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  const crossSite = await ana.post('/api/posts', { body: 'hello' }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(crossSite.status, 403);
  const loginFromElsewhere = await s.client().post('/api/auth/login', { identifier: 'ana', password: PASSWORD }, { Origin: 'https://evil.example' });
  assert.equal(loginFromElsewhere.status, 403);
});

test('sign-in gives one vague answer for wrong passwords and unknown accounts, then locks', async () => {
  const c = s.client();
  const wrong = await c.post('/api/auth/login', { identifier: 'ben', password: 'not the password' });
  const unknown = await c.post('/api/auth/login', { identifier: 'nobody_here', password: 'not the password' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.data.error, unknown.data.error);

  for (let i = 0; i < 4; i++) await c.post('/api/auth/login', { identifier: 'ben', password: 'still wrong' });
  const locked = await c.post('/api/auth/login', { identifier: 'ben', password: PASSWORD });
  assert.equal(locked.status, 429, 'correct password is refused while locked');
  for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { identifier: 'ghost_user', password: 'still wrong' });
  assert.equal((await c.post('/api/auth/login', { identifier: 'ghost_user', password: 'x' })).status, 429, 'unknown accounts lock the same way');
  s.app.limiter.hits.clear();

  const byEmail = await c.post('/api/auth/login', { identifier: 'BEN@example.test', password: PASSWORD });
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.data.user.handle, 'ben');
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/feed')).status, 401);
});

test('password reset: one-time link, ends every session, never reveals who has an account', async () => {
  const dan = s.client();
  await dan.signup('dan');
  const anon = s.client();
  const a = await anon.post('/api/auth/forgot', { email: 'dan@example.test' });
  const b = await anon.post('/api/auth/forgot', { email: 'nobody@example.test' });
  assert.deepEqual(a.data, b.data);
  const token = /token=([\w-]+)/.exec(s.app.mailer.sent.at(-1).body)[1];
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'short' })).status, 400);
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'a brand new passphrase' })).status, 200);
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'another new passphrase' })).status, 400, 'link works once');
  assert.equal((await dan.get('/api/feed')).status, 401, 'old session was ended');
  assert.equal((await anon.post('/api/auth/login', { identifier: 'dan', password: PASSWORD })).status, 401);
  assert.equal((await anon.post('/api/auth/login', { identifier: 'dan', password: 'a brand new passphrase' })).status, 200);
});

test('two-step sign-in with authenticator codes and one-time recovery codes', async () => {
  const eve = s.client();
  await eve.signup('eve');
  assert.equal((await eve.post('/api/account/two-factor/setup', { password: 'wrong password!' })).status, 403);
  const setup = await eve.post('/api/account/two-factor/setup', { password: PASSWORD });
  assert.equal((await eve.post('/api/account/two-factor/enable', { code: '000000' })).status, 400);
  const enabled = await eve.post('/api/account/two-factor/enable', { code: totpAt(setup.data.secret, totpStep()) });
  assert.equal(enabled.data.recoveryCodes.length, 8);

  const c = s.client();
  const step1 = await c.post('/api/auth/login', { identifier: 'eve', password: PASSWORD });
  assert.equal(step1.data.twoFactor, true);
  assert.equal(step1.data.user, undefined);
  assert.equal((await c.get('/api/feed')).status, 401, 'password alone is not enough');
  assert.equal((await c.post('/api/auth/two-factor', { ticket: step1.data.ticket, code: '123456' })).status, 401);
  const replay = await c.post('/api/auth/two-factor', { ticket: step1.data.ticket, code: totpAt(setup.data.secret, totpStep()) });
  assert.equal(replay.status, 401, 'a code that was already used is refused');
  const ok = await c.post('/api/auth/two-factor', { ticket: step1.data.ticket, code: totpAt(setup.data.secret, totpStep() + 1) });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.twoFactor, true);

  const d = s.client();
  const again = await d.post('/api/auth/login', { identifier: 'eve', password: PASSWORD });
  const code = enabled.data.recoveryCodes[0];
  assert.equal((await d.post('/api/auth/two-factor', { ticket: again.data.ticket, code })).status, 200);
  const third = await s.client().post('/api/auth/login', { identifier: 'eve', password: PASSWORD });
  assert.equal((await s.client().post('/api/auth/two-factor', { ticket: third.data.ticket, code })).status, 401, 'recovery codes work once');
});

test('sessions can be listed and ended; changing password signs other devices out', async () => {
  const fay = s.client();
  await fay.signup('fay');
  const phone = s.client();
  await phone.post('/api/auth/login', { identifier: 'fay', password: PASSWORD });
  const list = await fay.get('/api/account/sessions');
  assert.equal(list.data.items.length, 2);
  assert.equal(list.data.items.filter((x) => x.current).length, 1);
  assert.equal((await fay.post('/api/account/password', { current: 'nope nope nope', next: 'a much better passphrase' })).status, 403);
  assert.equal((await fay.post('/api/account/password', { current: PASSWORD, next: 'a much better passphrase' })).status, 200);
  assert.equal((await phone.get('/api/feed')).status, 401);
  assert.equal((await fay.get('/api/feed')).status, 200);
});

/* ---------- posts, follows, feeds ---------- */

test('posting, liking, reposting, comment threads and delete permissions', async () => {
  assert.equal((await ana.post('/api/posts', { body: '' })).status, 400);
  assert.equal((await ana.post('/api/posts', { body: 'x', tags: ['Nonsense'] })).status, 400);
  assert.equal((await ana.post('/api/posts', { body: 'x'.repeat(2001) })).status, 400);
  const made = await ana.post('/api/posts', { body: 'A personal space on the internet.', tags: ['Design'] });
  assert.equal(made.status, 201);
  const id = made.data.post.id;

  const liked = await ben.post(`/api/posts/${id}/like`);
  await ben.post(`/api/posts/${id}/like`);
  assert.equal(liked.data.post.likeCount, 1);
  assert.equal((await ben.get(`/api/posts/${id}`)).data.post.likeCount, 1, 'liking twice counts once');
  assert.equal((await ben.del(`/api/posts/${id}/like`)).data.post.likeCount, 0);

  assert.equal((await ana.post(`/api/posts/${id}/repost`)).status, 400, 'no reposting your own post');
  await cy.post('/api/users/ben/follow');
  await ben.post(`/api/posts/${id}/repost`);
  const feed = await cy.get('/api/feed?scope=following');
  assert.equal(feed.data.items[0].post.id, id);
  assert.equal(feed.data.items[0].repostedBy.handle, 'ben', 'a real repost reaches followers');
  const profile = await cy.get('/api/users/ben/feed');
  assert.equal(profile.data.items[0].repostedBy.handle, 'ben');

  const top = await ben.post(`/api/posts/${id}/comments`, { body: 'Agreed.' });
  const reply = await cy.post(`/api/posts/${id}/comments`, { body: 'Same here.', parentId: top.data.id });
  const thread = await ana.get(`/api/posts/${id}`);
  assert.equal(thread.data.comments.find((c) => c.id === reply.data.id).parentId, top.data.id);
  assert.equal((await cy.del(`/api/comments/${top.data.id}`)).status, 403, 'strangers cannot remove comments');
  assert.equal((await ana.del(`/api/comments/${top.data.id}`)).status, 200, 'the post author can');
  const after = await ana.get(`/api/posts/${id}`);
  const removed = after.data.comments.find((c) => c.id === top.data.id);
  assert.equal(removed.body, null, 'a removed comment with replies keeps its place but loses its text');

  assert.equal((await ben.del(`/api/posts/${id}`)).status, 403);
  assert.equal((await ana.del(`/api/posts/${id}`)).status, 200);
  assert.equal((await ben.get(`/api/posts/${id}`)).status, 404);
});

test('explore puts your interests and the people you follow first', async () => {
  await ben.post('/api/posts', { body: 'Older, but about film.', tags: ['Film'] });
  await ana.post('/api/posts', { body: 'Newer, untagged.' });
  await cy.patch('/api/profile', { interests: ['Film'] });
  const feed = await cy.get('/api/feed');
  assert.equal(feed.data.items[0].post.body, 'Older, but about film.');
  const filtered = await cy.get('/api/feed?tag=Film');
  assert.ok(filtered.data.items.every((i) => i.post.tags.includes('Film')));
});

test('notifications are created for the right person and never for yourself', async () => {
  const p = await ana.post('/api/posts', { body: 'Notify me.' });
  await ana.post(`/api/posts/${p.data.post.id}/like`);
  await ben.post(`/api/posts/${p.data.post.id}/like`);
  await ben.del(`/api/posts/${p.data.post.id}/like`);
  await ben.post(`/api/posts/${p.data.post.id}/like`);
  const list = await ana.get('/api/notifications');
  const likes = list.data.items.filter((n) => n.type === 'like' && n.postId === p.data.post.id);
  assert.equal(likes.length, 1);
  assert.equal(likes[0].actor.handle, 'ben');
  assert.ok((await ana.get('/api/counts')).data.notifications >= 1);
  await ana.post('/api/notifications/read');
  assert.equal((await ana.get('/api/counts')).data.notifications, 0);
});

/* ---------- boards ---------- */

test('boards: saving posts, private boards stay private, other people cannot edit yours', async () => {
  const p = await ben.post('/api/posts', { body: 'Worth keeping.' });
  const open = await ana.post('/api/boards', { name: 'References' });
  const secret = await ana.post('/api/boards', { name: 'Drafts', isPrivate: true });
  assert.equal((await ana.post('/api/boards', { name: 'references' })).status, 400);
  const saved = await ana.put(`/api/boards/${open.data.board.id}/items/${p.data.post.id}`);
  assert.equal(saved.data.post.saved, true);
  await ana.put(`/api/boards/${secret.data.board.id}/items/${p.data.post.id}`);

  const seen = await ben.get('/api/users/ana/boards');
  assert.deepEqual(seen.data.items.map((b) => b.name), ['References']);
  assert.equal((await ana.get('/api/users/ana/boards')).data.items.length, 2);
  assert.equal((await ben.get(`/api/boards/${secret.data.board.id}`)).status, 404);
  assert.equal((await ben.get(`/api/boards/${open.data.board.id}`)).data.items.length, 1);
  assert.equal((await ben.put(`/api/boards/${open.data.board.id}/items/${p.data.post.id}`)).status, 403);
  assert.equal((await ben.del(`/api/boards/${open.data.board.id}`)).status, 403);
});

/* ---------- anonymous questions ---------- */

test('anonymous questions never tell the recipient who asked', async () => {
  assert.equal((await ben.post('/api/users/ana/questions', { body: 'What are you reading this month?' })).status, 201);
  assert.equal((await ana.post('/api/users/ana/questions', { body: 'Me?' })).status, 400);

  const benId = s.app.db.get("SELECT id FROM users WHERE handle = 'ben'").id;
  const leaks = (data) => {
    const json = JSON.stringify(data);
    return /"ben"|sender|sender_id/i.test(json) || json.includes(`"actorId":${benId}`);
  };
  const inbox = await ana.get('/api/questions/inbox');
  assert.equal(inbox.data.items.length, 1);
  assert.deepEqual(Object.keys(inbox.data.items[0]).sort(), ['body', 'createdAt', 'id']);
  assert.ok(!leaks(inbox.data));
  const notes = await ana.get('/api/notifications');
  const note = notes.data.items.find((n) => n.type === 'question');
  assert.equal(note.actor, null);
  assert.ok(!leaks(note));

  const qid = inbox.data.items[0].id;
  assert.equal((await cy.post(`/api/questions/${qid}/answer`, { body: 'Hijack' })).status, 404, 'only the recipient can answer');
  const answered = await ana.post(`/api/questions/${qid}/answer`, { body: 'Mostly essays.' });
  assert.ok(!leaks(answered.data));

  const discover = await cy.get('/api/questions/answers');
  assert.equal(discover.data.items[0].answer, 'Mostly essays.');
  assert.ok(!leaks(discover.data));
  const onProfile = await cy.get('/api/users/ana/feed');
  assert.ok(onProfile.data.items.some((i) => i.type === 'answer' && i.answer.id === qid), 'answers show on the profile feed');
  assert.ok(!leaks(onProfile.data.items.filter((i) => i.type === 'answer')));
  assert.ok(!leaks((await ana.get('/api/account/export')).data.questionsReceived));

  const sent = await ben.get('/api/questions/sent');
  assert.equal(sent.data.items[0].answer, 'Mostly essays.', 'the asker can follow their own question');
  assert.equal((await cy.get('/api/questions/sent')).data.items.length, 0);
  assert.ok((await ben.get('/api/notifications')).data.items.some((n) => n.type === 'answer'));
});

test('a recipient can silence an anonymous sender without learning who it is', async () => {
  await ben.post('/api/users/ana/questions', { body: 'An unwelcome question' });
  const inbox = await ana.get('/api/questions/inbox');
  const silenced = await ana.post(`/api/questions/${inbox.data.items[0].id}/silence`);
  assert.deepEqual(silenced.data, { ok: true });
  const next = await ben.post('/api/users/ana/questions', { body: 'Another one' });
  assert.equal(next.status, 201, 'the sender is not told');
  assert.equal((await ana.get('/api/questions/inbox')).data.items.length, 0);
  await cy.post('/api/users/ana/questions', { body: 'From someone else' });
  assert.equal((await ana.get('/api/questions/inbox')).data.items.length, 1);
});

test('questions can be switched off and are rate limited per person', async () => {
  await cy.patch('/api/profile', { allowQuestions: false });
  assert.equal((await ana.post('/api/users/cy_/questions', { body: 'Hello?' })).status, 403);
  await cy.patch('/api/profile', { allowQuestions: true });
  const strict = await startServer({ rateScale: 1 });
  try {
    const [a, b] = [strict.client(), strict.client()];
    await a.signup('asker');
    await b.signup('target');
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await a.post('/api/users/target/questions', { body: `Question ${i}` })).status);
    assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
  } finally { await strict.stop(); }
});

/* ---------- messages and blocking ---------- */

test('messages respect who-can-message-me settings', async () => {
  assert.equal((await ben.post('/api/conversations/ana', { body: 'Hi Ana' })).status, 201);
  assert.equal((await ana.get('/api/counts')).data.messages, 1);
  const convo = await ana.get('/api/conversations/ben');
  assert.equal(convo.data.messages[0].body, 'Hi Ana');
  assert.equal((await ana.get('/api/counts')).data.messages, 0, 'opening the conversation marks it read');
  assert.equal((await cy.get('/api/conversations/ana')).data.messages.length, 0, 'a third person sees nothing');

  await ana.patch('/api/profile', { dmPolicy: 'following' });
  assert.equal((await cy.post('/api/conversations/ana', { body: 'Hello' })).status, 403);
  await ana.post('/api/users/cy_/follow');
  assert.equal((await cy.post('/api/conversations/ana', { body: 'Hello' })).status, 201);
  await ana.patch('/api/profile', { dmPolicy: 'none' });
  assert.equal((await cy.post('/api/conversations/ana', { body: 'Again' })).status, 403);
  await ana.patch('/api/profile', { dmPolicy: 'everyone' });
});

test('new messages arrive over the live connection', async () => {
  const controller = new AbortController();
  const stream = await fetch(`${s.base}/api/events`, { headers: { Cookie: ana.cookie }, signal: controller.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  await ben.post('/api/conversations/ana', { body: 'Live?' });
  let textSoFar = '';
  while (!textSoFar.includes('event: message')) textSoFar += new TextDecoder().decode((await reader.read()).value);
  assert.match(textSoFar, /"body":"Live\?"/);
  controller.abort();
  assert.equal((await fetch(`${s.base}/api/events`)).status, 401);
});

test('blocking hides both people from each other everywhere', async () => {
  const gus = s.client();
  const hal = s.client();
  await gus.signup('gus');
  await hal.signup('hal');
  await hal.post('/api/users/gus/follow');
  const post = await gus.post('/api/posts', { body: 'Gus was here.' });
  await hal.post('/api/conversations/gus', { body: 'Hey' });
  assert.equal((await gus.post('/api/users/hal/block')).status, 200);

  assert.equal((await hal.get('/api/users/gus')).status, 404);
  assert.equal((await hal.get(`/api/posts/${post.data.post.id}`)).status, 404);
  assert.equal((await hal.post(`/api/posts/${post.data.post.id}/like`)).status, 404);
  assert.equal((await hal.post('/api/users/gus/follow')).status, 404);
  assert.equal((await hal.post('/api/conversations/gus', { body: 'Hello?' })).status, 404);
  assert.equal((await hal.post('/api/users/gus/questions', { body: 'Why?' })).status, 404);
  assert.ok(!(await hal.get('/api/feed')).data.items.some((i) => i.post.author.handle === 'gus'));
  assert.ok(!(await hal.get('/api/search?q=gus')).data.users.length);
  assert.equal((await gus.get('/api/conversations')).data.items.length, 0);
  assert.equal((await gus.get('/api/users/gus')).data.counts.followers, 0, 'blocking removes the follow');
  assert.deepEqual((await gus.get('/api/blocks')).data.items.map((u) => u.handle), ['hal']);
  await gus.del('/api/users/hal/block');
  assert.equal((await hal.get('/api/users/gus')).status, 200);
});

/* ---------- uploads ---------- */

test('uploads are checked by content, stripped of metadata, and tied to their owner', async () => {
  const fake = await ana.post('/api/uploads', Buffer.from('<script>alert(1)</script>'), { 'Content-Type': 'image/png' });
  assert.equal(fake.status, 400);
  assert.equal((await ana.post('/api/uploads', Buffer.alloc(5 * 1024 * 1024 + 10))).status, 413);

  const exif = Buffer.from('Exif\0\0GPS: 33.7490 N, 84.3880 W');
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0, exif.length + 2]), exif]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xdb, 0, 3, 1, 0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9])]);
  const up = await ana.post('/api/uploads', jpeg);
  assert.equal(up.status, 201);
  const stored = Buffer.from((await ana.get(up.data.url)).data);
  assert.ok(!stored.includes('GPS'), 'location metadata is gone');
  assert.ok(stored.length < jpeg.length);

  const pic = await ana.post('/api/uploads', png);
  const served = await ana.get(pic.data.url);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await s.client().get(pic.data.url)).status, 401);
  assert.equal((await ben.post('/api/posts', { body: 'Stolen', image: pic.data.url })).status, 400, "cannot attach someone else's upload");
  assert.equal((await ana.post('/api/posts', { body: 'x', image: 'https://evil.example/x.png' })).status, 400);
  assert.equal((await ana.post('/api/posts', { body: '', image: pic.data.url })).status, 201);
});

/* ---------- profile ---------- */

test('profile fields are validated; music must be a link to a licensed player', async () => {
  for (const background of ['url(https://evil.example/x.png)', { type: 'color', color: 'red; background: url(//evil.example)' },
    { type: 'gradient', from: '#000000', to: 'expression(alert(1))' }, { type: 'image', url: 'https://evil.example/x.png' }, { type: 'nope' }]) {
    assert.equal((await ana.patch('/api/profile', { background })).status, 400, JSON.stringify(background));
    assert.equal((await ana.patch('/api/profile', { appBackground: background })).status, 400, JSON.stringify(background));
  }
  const own = await ana.post('/api/uploads', png);
  const custom = await ana.patch('/api/profile', { background: { type: 'gradient', from: '#FF00AA', to: '#00ffcc', angle: 999 }, appBackground: { type: 'image', url: own.data.url } });
  assert.deepEqual(custom.data.user.background, { type: 'gradient', from: '#ff00aa', to: '#00ffcc', angle: 360 });
  assert.equal(custom.data.user.appBackground.url, own.data.url);
  assert.equal(custom.data.user.appBackground.fit, 'cover', 'pictures are full screen unless asked otherwise');
  const tiled = await ana.patch('/api/profile', { appBackground: { type: 'image', url: own.data.url, fit: 'tile', size: 99999 } });
  assert.deepEqual(tiled.data.user.appBackground, { type: 'image', url: own.data.url, fit: 'tile', size: 800 });
  assert.equal((await ana.patch('/api/profile', { background: { type: 'image', url: own.data.url, fit: 'tile; x' } })).data.user.background.fit, 'cover');
  assert.equal((await ben.patch('/api/profile', { background: { type: 'image', url: own.data.url } })).status, 400, "someone else's image");
  assert.equal((await ana.patch('/api/profile', { appBackground: null })).data.user.appBackground, null);
  assert.equal((await ana.patch('/api/profile', { musicUrl: 'https://evil.example/track.mp3' })).status, 400);
  assert.equal((await ana.patch('/api/profile', { musicUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await ana.patch('/api/profile', { interests: ['Hacking'] })).status, 400);
  const ok = await ana.patch('/api/profile', { bio: '  Reader.‮  ', background: { type: 'color', color: '#4a5d43' }, musicUrl: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc', interests: ['Books', 'Film'] });
  assert.equal(ok.data.user.bio, 'Reader.');
  assert.equal(ok.data.user.music.embed, 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC');
  const seen = await ben.get('/api/users/ana');
  assert.equal(seen.data.music.provider, 'Spotify');
  assert.deepEqual(seen.data.background, { type: 'color', color: '#4a5d43' });
  assert.equal(seen.data.appBackground, undefined, 'your app background is yours alone');
  assert.equal(seen.data.email, undefined, 'email is never shown to other people');
  assert.equal(JSON.stringify(seen.data).includes('example.test'), false);
});

/* ---------- reports and moderation ---------- */

test('reports reach moderators only; moderators can see who sent an anonymous question and suspend them', async () => {
  const ivy = s.client();
  const jon = s.client();
  const mod = s.client();
  await ivy.signup('ivy');
  await jon.signup('jon');
  await mod.signup('mod_');
  s.app.db.run("UPDATE users SET role = 'admin' WHERE handle = 'mod_'");

  await jon.post('/api/users/ivy/questions', { body: 'Something abusive' });
  const q = (await ivy.get('/api/questions/inbox')).data.items[0];
  assert.equal((await ivy.post('/api/reports', { targetType: 'question', targetId: q.id, reason: 'nonsense' })).status, 400);
  assert.equal((await ana.post('/api/reports', { targetType: 'question', targetId: q.id, reason: 'harassment' })).status, 404, 'cannot report what you cannot see');
  assert.equal((await ivy.post('/api/reports', { targetType: 'question', targetId: q.id, reason: 'harassment', details: 'Please look.' })).status, 201);

  assert.equal((await ivy.get('/api/admin/reports')).status, 404);
  assert.equal((await ivy.post('/api/admin/reports/1/resolve', { action: 'dismiss' })).status, 404);
  const queue = await mod.get('/api/admin/reports');
  const report = queue.data.items.find((r) => r.targetType === 'question');
  assert.equal(report.account.handle, 'jon');
  assert.equal(report.reporter, 'ivy');

  assert.equal((await mod.post(`/api/admin/reports/${report.id}/resolve`, { action: 'suspend' })).status, 200);
  assert.equal((await jon.get('/api/feed')).status, 401, 'suspension ends their session');
  assert.equal((await s.client().post('/api/auth/login', { identifier: 'jon', password: PASSWORD })).status, 403);
  assert.equal((await ivy.get('/api/users/jon')).status, 404);
  assert.equal((await ivy.get('/api/questions/inbox')).data.items.length, 0, 'the reported question is removed');
  assert.equal((await mod.get('/api/admin/reports')).data.items.length, 0);
  await mod.post('/api/admin/users/jon/reinstate');
  assert.equal((await s.client().post('/api/auth/login', { identifier: 'jon', password: PASSWORD })).status, 200);
});

/* ---------- account ---------- */

test('deleting an account needs the password and removes its content', async () => {
  const kim = s.client();
  await kim.signup('kim');
  const p = await kim.post('/api/posts', { body: 'Soon gone.' });
  await kim.post('/api/users/ana/questions', { body: 'Will this survive?' });
  assert.equal((await kim.post('/api/account/delete', { password: 'wrong password' })).status, 403);
  assert.equal((await kim.post('/api/account/delete', { password: PASSWORD })).status, 200);
  assert.equal((await kim.get('/api/session')).data.user, null);
  assert.equal((await ana.get(`/api/posts/${p.data.post.id}`)).status, 404);
  assert.equal((await ana.get('/api/users/kim')).status, 404);
  assert.ok((await ana.get('/api/questions/inbox')).data.items.some((q) => q.body === 'Will this survive?'), 'questions they sent stay with the recipient');
  assert.equal((await ana.get('/api/auth/handle-available?handle=kim')).data.available, true);
});

/* ---------- transport ---------- */

test('security headers are set and paths cannot escape the public folder', async () => {
  const res = await fetch(`${s.base}/api/session`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  for (const path of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/server/index.js', '/uploads/..%2fanonymous.db']) {
    const r = await fetch(s.base + path);
    assert.ok([400, 401, 404].includes(r.status), `${path} -> ${r.status}`);
  }
  const big = await ana.request('POST', '/api/posts', undefined, { 'Content-Type': 'application/json', 'Content-Length': '999999' });
  assert.ok([400, 413].includes(big.status));
});

test('production cookies are Secure and use the __Host- prefix', async () => {
  const prod = await startServer({ production: true, cookieSecure: true });
  try {
    const c = prod.client();
    await c.signup('prod_user');
    assert.match(c.lastSetCookie, /^__Host-anon_sid=/);
    assert.match(c.lastSetCookie, /; Secure/);
    assert.match((await fetch(`${prod.base}/api/session`)).headers.get('strict-transport-security'), /max-age/);
  } finally { await prod.stop(); }
});
