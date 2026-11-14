import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, LIMITS } from './config.js';
import { openDatabase } from './db.js';
import { HttpError, Router, parseCookies, readBody, readJson } from './http.js';
import { RateLimiter, hashPassword, randomToken, safeEqual, sha256 } from './security.js';
import { Realtime } from './realtime.js';
import { createMailer } from './mailer.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import postRoutes from './routes/posts.js';
import boardRoutes from './routes/boards.js';
import questionRoutes from './routes/questions.js';
import messageRoutes from './routes/messages.js';
import safetyRoutes from './routes/safety.js';
import uploadRoutes from './routes/uploads.js';

const SESSION_TTL = 30 * 24 * 3600_000;
const MINUTE = 60_000;

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' blob: data:", "connect-src 'self'",
  'frame-src https://open.spotify.com https://w.soundcloud.com https://www.youtube-nocookie.com https://embed.music.apple.com',
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
const UPLOAD_TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };

export async function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDatabase(config.dbFile || path.join(config.dataDir, 'anonymous.db'));
  const uploadsDir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const app = {
    config, db, uploadsDir,
    limiter: new RateLimiter(),
    realtime: new Realtime(),
    mailer: createMailer(config),
    router: new Router(),
    pendingTwoFactor: new Map(),
    cookieName: config.cookieSecure ? '__Host-anon_sid' : 'anon_sid',
    // Compared against when the account does not exist, so both cases take the same time.
    dummyHash: await hashPassword(randomToken(), config.scryptN),
    rateScale: config.rateScale || 1,
  };

  /** Throws 429 when `key` has been used more than `limit` times in the window. */
  app.limit = (key, limit, windowMs) => {
    const wait = app.limiter.take(key, limit * app.rateScale, windowMs);
    if (wait) throw tooMany(wait);
  };

  app.startSession = (ctx, userId) => {
    const token = randomToken();
    const csrf = randomToken(24);
    const t = Date.now();
    db.run('INSERT INTO sessions (user_id, token_hash, csrf, user_agent, ip, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, sha256(token), csrf, String(ctx.req.headers['user-agent'] || '').slice(0, 300), ctx.ip, t, t, t + SESSION_TTL]);
    ctx.cookies.push(cookie(app, token, SESSION_TTL / 1000));
    return csrf;
  };
  app.clearCookie = (ctx) => ctx.cookies.push(cookie(app, '', 0));

  for (const register of [authRoutes, userRoutes, postRoutes, boardRoutes, questionRoutes, messageRoutes, safetyRoutes, uploadRoutes]) {
    register(app);
  }

  const sweep = setInterval(() => {
    const t = Date.now();
    db.run('DELETE FROM sessions WHERE expires_at < ?', [t]);
    db.run('DELETE FROM password_resets WHERE expires_at < ?', [t - 24 * 3600_000]);
    for (const [k, v] of app.pendingTwoFactor) if (v.expires < t) app.pendingTwoFactor.delete(k);
  }, 10 * MINUTE);
  sweep.unref();

  app.handler = (req, res) => { handle(app, req, res); };
  app.close = () => { clearInterval(sweep); app.limiter.stop(); app.realtime.stop(); db.close(); };
  return app;
}

const tooMany = (wait) => new HttpError(429,
  wait > 90 ? `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` : 'Too many attempts. Try again in a minute.',
  { retryAfter: wait });

function cookie(app, value, maxAge) {
  return `${app.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge)}${app.config.cookieSecure ? '; Secure' : ''}`;
}

function clientIp(app, req) {
  if (app.config.trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (fwd.length) return fwd[fwd.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

function loadSession(app, req) {
  const token = parseCookies(req.headers.cookie)[app.cookieName];
  if (!token) return null;
  const row = app.db.get('SELECT s.id AS session_id, s.csrf, s.expires_at, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [sha256(token)]);
  if (!row) return null;
  const t = Date.now();
  if (row.expires_at < t || row.suspended_at) {
    app.db.run('DELETE FROM sessions WHERE id = ?', [row.session_id]);
    return null;
  }
  if (t - row.last_seen_at > MINUTE) {
    app.db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [t, t + SESSION_TTL, row.session_id]);
  }
  const { session_id: id, csrf, expires_at: _e, last_seen_at: _l, ...user } = row;
  return { id, csrf, user };
}

/** Reject writes that a different website asked the browser to send. */
function checkOrigin(app, req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'That request came from another site.');
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try { host = new URL(origin).host; } catch { throw new HttpError(403, 'That request came from another site.'); }
  const allowed = [req.headers.host];
  if (app.config.publicOrigin) allowed.push(new URL(app.config.publicOrigin).host);
  if (!allowed.includes(host)) throw new HttpError(403, 'That request came from another site.');
}

function baseHeaders(app, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (app.config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function sendJson(res, status, body, cookies = []) {
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function handle(app, req, res) {
  baseHeaders(app, res);
  const cookies = [];
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/api/')) await api(app, req, res, url, cookies);
    else if (url.pathname.startsWith('/uploads/')) serveUpload(app, req, res, url);
    else serveStatic(app, req, res, url);
  } catch (err) {
    if (res.headersSent) { res.end(); return; }
    if (err instanceof HttpError) {
      if (err.extra.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
      sendJson(res, err.status, { error: err.message, ...err.extra }, cookies);
    } else {
      if (!app.config.quiet) console.error(err);
      sendJson(res, 500, { error: 'Something went wrong on our side. Try again.' }, cookies);
    }
  }
}

async function api(app, req, res, url, cookies) {
  const ip = clientIp(app, req);
  app.limit(`all:${ip}`, 600, MINUTE);

  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const { route, params, pathMatched } = app.router.match(method, url.pathname);
  if (!route) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'That action is not supported here.' : 'Not found.');

  const session = loadSession(app, req);
  const write = method !== 'GET';
  if (write) checkOrigin(app, req);
  if (route.opts.auth !== false) {
    if (!session) throw new HttpError(401, 'Sign in to continue.');
    if (write && !safeEqual(req.headers['x-csrf-token'] || '', session.csrf)) {
      throw new HttpError(403, 'Your session needs refreshing. Reload the page and try again.');
    }
    if (route.opts.admin && session.user.role !== 'admin') throw new HttpError(404, 'Not found.');
  }

  const who = session ? `u${session.user.id}` : ip;
  if (write) app.limit(`write:${who}`, 240, 5 * MINUTE);
  if (route.opts.limit) {
    const [name, limit, windowMs] = route.opts.limit;
    app.limit(`${name}:${route.opts.auth === false ? ip : who}`, limit, windowMs);
  }

  const body = !write ? {} : route.opts.raw ? await readBody(req, LIMITS.upload) : await readJson(req);
  const ctx = { app, db: app.db, req, res, params, query: url.searchParams, body, ip, cookies, session, me: session?.user || null, status: 200 };
  const result = await route.handler(ctx);
  if (res.headersSent) return;
  sendJson(res, ctx.status, result ?? { ok: true }, cookies);
}

function serveUpload(app, req, res, url) {
  const m = /^\/uploads\/([a-f0-9]{32})\.(jpg|png|gif)$/.exec(url.pathname);
  if (!m || (req.method !== 'GET' && req.method !== 'HEAD')) throw new HttpError(404, 'Not found.');
  if (!loadSession(app, req)) throw new HttpError(401, 'Sign in to continue.');
  const file = path.join(app.uploadsDir, `${m[1]}.${m[2]}`);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Not found.');
  res.writeHead(200, {
    'Content-Type': UPLOAD_TYPES[m[2]],
    'Content-Length': fs.statSync(file).size,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': 'inline',
  });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
}

function serveStatic(app, req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'That action is not supported here.');
  const dist = app.config.distDir;
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'That address is not valid.'); }
  let file = path.join(dist, path.normalize(rel));
  if (!file.startsWith(dist + path.sep) && file !== dist) throw new HttpError(404, 'Not found.');
  const isAsset = fs.existsSync(file) && fs.statSync(file).isFile();
  if (!isAsset) {
    if (path.extname(rel)) throw new HttpError(404, 'Not found.');
    file = path.join(dist, 'index.html'); // client-side routes
    if (!fs.existsSync(file)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The interface has not been built yet.\n\nRun "npm run build" and then "npm start", or use "npm run dev" while developing.\n');
      return;
    }
  }
  const ext = path.extname(file);
  const headers = { 'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size };
  if (ext === '.html') { headers['Content-Security-Policy'] = CSP; headers['Cache-Control'] = 'no-cache'; }
  else headers['Cache-Control'] = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
}
