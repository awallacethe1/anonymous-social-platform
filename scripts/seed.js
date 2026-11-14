// Optional demo content for local development: npm run seed
// Creates a few example accounts (password for all of them: "demo passphrase 1") so the app is not empty.
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/security.js';

const config = loadConfig();
if (config.production) { console.error('Refusing to add demo content in production.'); process.exit(1); }
const db = openDatabase(path.join(config.dataDir, 'anonymous.db'));
if (db.get("SELECT 1 x FROM users WHERE handle = 'marcelle'")) { console.log('Demo content is already there.'); process.exit(0); }

const PASSWORD = 'demo passphrase 1';
const hash = await hashPassword(PASSWORD, config.scryptN);
const HOUR = 3600_000;
const t0 = Date.now();

const people = [
  ['marcelle', 'Marcelle Okafor', 'Collecting type specimens and train tickets.', { type: 'gradient', from: '#2b2140', to: '#b5546b', angle: 135 }, ['Design', 'Art', 'Travel']],
  ['lennox', 'Lennox Reyes', 'Records, photographs and everything in between.', { type: 'gradient', from: '#0f3d4c', to: '#7fb5b0', angle: 135 }, ['Music', 'Film', 'Art']],
  ['priya_k', 'Priya Kapoor', 'Reads slowly, writes slower.', { type: 'color', color: '#4a5d43' }, ['Books', 'Writing', 'Education']],
  ['tobias', 'Tobias Lindqvist', 'Small games, big spreadsheets.', { type: 'color', color: '#3b4652' }, ['Games', 'Tech', 'Business']],
];
const ids = {};
for (const [handle, name, bio, background, interests] of people) {
  ids[handle] = Number(db.run('INSERT INTO users (handle, email, display_name, password_hash, bio, background, interests, onboarded, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
    [handle, `${handle}@example.test`, name, hash, bio, JSON.stringify(background), JSON.stringify(interests), t0 - 72 * HOUR]).lastInsertRowid);
}

const posts = [
  ['marcelle', 'What happened to having a personal space on the internet?', ['Design'], 30],
  ['lennox', 'Collecting ideas, music, photographs, and everything in between.', ['Music', 'Art'], 26],
  ['priya_k', 'Finished a novel on the train this morning and missed my stop on purpose to read the last chapter.', ['Books'], 20],
  ['tobias', 'A game is finished when the spreadsheet stops surprising you.', ['Games', 'Tech'], 14],
  ['marcelle', 'Three typefaces is two too many. Pick one and learn what it can do.', ['Design'], 9],
  ['lennox', 'Saw a 35mm print of a film I had only ever watched on a laptop. It is a different film.', ['Film'], 5],
  ['priya_k', 'Drafts are letters to yourself. Most of them should stay unsent.', ['Writing'], 2],
];
const postIds = posts.map(([handle, body, tags, hoursAgo]) => {
  const id = Number(db.run('INSERT INTO posts (author_id, body, tags, created_at) VALUES (?, ?, ?, ?)', [ids[handle], body, JSON.stringify(tags), t0 - hoursAgo * HOUR]).lastInsertRowid);
  for (const tag of tags) db.run('INSERT INTO post_tags (post_id, tag) VALUES (?, ?)', [id, tag]);
  return id;
});

const follow = (a, b) => db.run('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', [ids[a], ids[b], t0 - 40 * HOUR]);
follow('marcelle', 'lennox'); follow('lennox', 'marcelle'); follow('priya_k', 'marcelle'); follow('tobias', 'lennox'); follow('priya_k', 'lennox');

const like = (who, i) => db.run('INSERT INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)', [ids[who], postIds[i], t0 - HOUR]);
like('lennox', 0); like('priya_k', 0); like('tobias', 0); like('marcelle', 1); like('marcelle', 2); like('lennox', 4); like('priya_k', 5);
db.run('INSERT INTO reposts (user_id, post_id, created_at) VALUES (?, ?, ?)', [ids.lennox, postIds[0], t0 - 4 * HOUR]);

const c1 = Number(db.run('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, ?)', [postIds[0], ids.lennox, 'It moved into group chats and never came back.', t0 - 28 * HOUR]).lastInsertRowid);
db.run('INSERT INTO comments (post_id, author_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?)', [postIds[0], ids.marcelle, c1, 'Then we build it again.', t0 - 27 * HOUR]);

const board = Number(db.run('INSERT INTO boards (owner_id, name, created_at) VALUES (?, ?, ?)', [ids.marcelle, 'Worth rereading', t0 - 10 * HOUR]).lastInsertRowid);
for (const i of [2, 5, 6]) db.run('INSERT INTO board_items (board_id, post_id, created_at) VALUES (?, ?, ?)', [board, postIds[i], t0 - i * HOUR]);

db.run('INSERT INTO questions (recipient_id, sender_id, body, created_at, answer, answered_at) VALUES (?, ?, ?, ?, ?, ?)',
  [ids.marcelle, ids.priya_k, 'What is the one typeface you would keep?', t0 - 12 * HOUR, 'Whichever one the printer down the road still has in metal.', t0 - 8 * HOUR]);
db.run('INSERT INTO questions (recipient_id, sender_id, body, created_at, answer, answered_at) VALUES (?, ?, ?, ?, ?, ?)',
  [ids.lennox, ids.tobias, 'Which record do you put on when nobody is listening?', t0 - 7 * HOUR, 'The same one as when everybody is.', t0 - 3 * HOUR]);

console.log(`Added ${people.length} demo accounts: ${people.map((p) => `@${p[0]}`).join(', ')}\nPassword for each: ${PASSWORD}`);
db.close();
