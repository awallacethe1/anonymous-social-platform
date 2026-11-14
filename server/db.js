import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const migrationsDir = path.join(import.meta.dirname, 'migrations');

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(raw);

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const args = (p) => (p === undefined ? [] : Array.isArray(p) ? p : [p]);

  return {
    raw,
    get: (sql, p) => stmt(sql).get(...args(p)),
    all: (sql, p) => stmt(sql).all(...args(p)),
    run: (sql, p) => stmt(sql).run(...args(p)),
    tx(fn) {
      raw.exec('BEGIN IMMEDIATE');
      try { const out = fn(); raw.exec('COMMIT'); return out; }
      catch (err) { raw.exec('ROLLBACK'); throw err; }
    },
    close: () => raw.close(),
  };
}

function migrate(raw) {
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(raw.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const name of files) {
    if (done.has(name)) continue;
    raw.exec('BEGIN');
    try {
      raw.exec(fs.readFileSync(path.join(migrationsDir, name), 'utf8'));
      raw.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
      raw.exec('COMMIT');
    } catch (err) {
      raw.exec('ROLLBACK');
      throw new Error(`Migration ${name} failed: ${err.message}`);
    }
  }
}
