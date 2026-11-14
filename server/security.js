import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

/* ---------- passwords ---------- */

export async function hashPassword(password, N = 2 ** 17) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, { N, r: 8, p: 1, maxmem: 256 * N * 8 });
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, n, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const N = Number(n);
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N, r: 8, p: 1, maxmem: 256 * N * 8 });
  return crypto.timingSafeEqual(key, expected);
}

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', '1234567890', '12345678910',
  'qwertyuiop', 'qwerty12345', 'iloveyou123', 'letmein123', 'welcome123', 'anonymous', 'anonymous1',
  'anonymous123', 'abcdefghij', 'abc1234567', '1q2w3e4r5t', 'qazwsxedcr', 'administrator', 'changeme123',
  'football123', 'baseball123', 'sunshine123', 'princess123', 'trustno1234', 'passw0rd123', '0987654321',
  'zxcvbnm123', 'asdfghjkl1', 'asdfghjkl123', 'monkey12345', 'dragon12345', 'master12345', 'superman123',
]);

/** Returns a reason the password is unacceptable, or null. */
export function passwordProblem(password, { handle = '', email = '' } = {}) {
  if (typeof password !== 'string') return 'Enter a password.';
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'Use 200 characters or fewer.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common. Choose something harder to guess.';
  if (/^(.)\1+$/.test(password)) return 'Use more than one repeated character.';
  const h = handle.toLowerCase();
  const local = email.toLowerCase().split('@')[0];
  if ((h.length >= 4 && lower.includes(h)) || (local.length >= 4 && lower.includes(local))) {
    return 'Leave your username and email out of your password.';
  }
  return null;
}

/* ---------- tokens ---------- */

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------- two-step sign-in (TOTP, RFC 6238) ---------- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of text.replace(/[\s=-]/g, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

export const totpStep = (now = Date.now()) => Math.floor(now / 30_000);

/** Returns the matching time step (newer than lastStep) or null. Each code works once. */
export function verifyTotp(secret, code, lastStep = 0, now = Date.now()) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const current = totpStep(now);
  for (const step of [current, current - 1, current + 1]) {
    if (step > lastStep && safeEqual(totpAt(secret, step), clean)) return step;
  }
  return null;
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function newRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(crypto.randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/* ---------- rate limiting (in memory, sliding window) ---------- */

export class RateLimiter {
  constructor() {
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref();
  }

  recent(key, windowMs, now) {
    const list = (this.hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }

  /** How many seconds until `key` is allowed again (0 = allowed now). Does not count a hit. */
  blockedFor(key, limit, windowMs, now = Date.now()) {
    const list = this.recent(key, windowMs, now);
    return list.length >= limit ? Math.ceil((list[0] + windowMs - now) / 1000) : 0;
  }

  record(key, now = Date.now()) {
    const list = this.hits.get(key) || [];
    list.push(now);
    this.hits.set(key, list);
  }

  /** Count a hit; returns seconds to wait if over the limit, else 0. */
  take(key, limit, windowMs, now = Date.now()) {
    const wait = this.blockedFor(key, limit, windowMs, now);
    if (!wait) this.record(key, now);
    return wait;
  }

  clear(key) { this.hits.delete(key); }

  sweep(now = Date.now()) {
    for (const [key, list] of this.hits) {
      if (!list.length || now - list[list.length - 1] > 24 * 3600_000) this.hits.delete(key);
    }
  }

  stop() { clearInterval(this.timer); }
}
