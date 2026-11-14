import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

/** Start a throwaway server with an in-memory database. */
export async function startServer(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymous-test-'));
  const app = await createApp({ dbFile: ':memory:', dataDir, scryptN: 1024, quiet: true, rateScale: 1000, production: false, cookieSecure: false, ...overrides });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app, base,
    client: () => new Client(base),
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** A pretend browser: remembers its cookie and CSRF token. */
export class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }

  async request(method, url, body, headers = {}) {
    const init = { method, headers: { ...headers } };
    if (this.cookie) init.headers.Cookie = this.cookie;
    if (this.csrf && method !== 'GET') init.headers['X-CSRF-Token'] ??= this.csrf;
    if (Buffer.isBuffer(body)) { init.body = body; init.headers['Content-Type'] ??= 'application/octet-stream'; }
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    const res = await fetch(this.base + url, init);
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      this.cookie = pair.endsWith('=') ? '' : pair;
      this.lastSetCookie = c;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    if (data && data.csrf) this.csrf = data.csrf;
    return { status: res.status, data, headers: res.headers };
  }
  get(url) { return this.request('GET', url); }
  post(url, body = {}, headers) { return this.request('POST', url, body, headers); }
  put(url, body = {}) { return this.request('PUT', url, body); }
  patch(url, body = {}) { return this.request('PATCH', url, body); }
  del(url) { return this.request('DELETE', url); }

  async signup(handle, extra = {}) {
    const res = await this.post('/api/auth/signup', {
      handle, email: `${handle}@example.test`, password: `correct horse ${handle}`.replace(handle, 'battery'), ageConfirmed: true, acceptedGuidelines: true, ...extra,
    });
    if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.data)}`);
    return res;
  }
}

export const PASSWORD = 'correct horse battery';
