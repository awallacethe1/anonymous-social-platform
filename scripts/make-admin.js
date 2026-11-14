// Usage: npm run make-admin -- <username>
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';

const handle = (process.argv[2] || '').replace(/^@/, '');
if (!handle) { console.error('Usage: npm run make-admin -- <username>'); process.exit(1); }
const config = loadConfig();
const db = openDatabase(path.join(config.dataDir, 'anonymous.db'));
const res = db.run("UPDATE users SET role = 'admin' WHERE handle = ?", [handle]);
console.log(res.changes ? `@${handle} is now a moderator. They will see Moderation in Settings.` : `No account is called @${handle}.`);
db.close();
