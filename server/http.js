import { LIMITS } from './config.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (message, field) => new HttpError(400, message, field ? { field } : {});
export const notFound = (what = 'That') => new HttpError(404, `${what} could not be found.`);
export const forbidden = (message = 'You do not have permission to do that.') => new HttpError(403, message);

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const source = pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
    this.routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler, opts });
  }
  get(p, h, o) { this.add('GET', p, h, o); }
  post(p, h, o) { this.add('POST', p, h, o); }
  put(p, h, o) { this.add('PUT', p, h, o); }
  patch(p, h, o) { this.add('PATCH', p, h, o); }
  delete(p, h, o) { this.add('DELETE', p, h, o); }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      try { route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); }
      catch { throw bad('That address is not valid.'); }
      return { route, params };
    }
    return { pathMatched };
  }
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { req.resume(); return reject(new HttpError(413, 'That is too large to send.')); }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { req.destroy(); reject(new HttpError(413, 'That is too large to send.')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req) {
  const type = String(req.headers['content-type'] || '');
  const buf = await readBody(req, LIMITS.json);
  if (!buf.length) return {};
  if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  try {
    const value = JSON.parse(buf.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch { throw bad('That request could not be read.'); }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/* ---------- input cleaning ---------- */

/** Trim, normalise, drop control characters, cap blank lines. Throws on wrong type or length. */
export function text(value, { name, max, min = 0, multiline = true }) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw bad(`${name} must be text.`);
  let out = value.normalize('NFC').replace(/\r\n?/g, '\n');
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g, '');
  out = multiline ? out.replace(/\n{3,}/g, '\n\n') : out.replace(/\n+/g, ' ');
  out = out.trim();
  if (out.length < min) throw bad(min === 1 ? `${name} cannot be empty.` : `${name} needs at least ${min} characters.`);
  if (out.length > max) throw bad(`${name} can be at most ${max} characters.`);
  return out;
}

export function integer(value, name = 'id') {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw bad(`That ${name} is not valid.`);
  return n;
}

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set(['admin', 'administrator', 'anonymous', 'moderator', 'support', 'help', 'api', 'login', 'signup',
  'settings', 'explore', 'following', 'create', 'questions', 'messages', 'notifications', 'profile', 'search', 'system',
  'staff', 'official', 'security', 'root', 'null', 'undefined', 'everyone', 'here', 'me']);

export function cleanHandle(value) {
  const handle = String(value ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE_RE.test(handle)) throw bad('Usernames are 3–20 characters: letters, numbers and underscores.', 'handle');
  return handle;
}
export const isReserved = (handle) => RESERVED.has(handle);

export function cleanEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw bad('Enter a valid email address.', 'email');
  return email;
}

export const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
