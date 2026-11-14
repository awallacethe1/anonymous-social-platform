import http from 'node:http';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Anonymous needs Node.js 22.13 or newer (you have ${process.versions.node}).\nInstall the current LTS release from https://nodejs.org and run this again.`);
  process.exit(1);
}

// Optional settings file. Absent in normal local use.
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* no .env file */ }

// The built-in SQLite module still prints an "experimental" notice on Node 22. It is expected.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning?.message || warning).includes('SQLite is an experimental feature')) return;
  emitWarning.call(process, warning, ...rest);
};

const { createApp } = await import('./app.js');
const app = await createApp();
const server = http.createServer(app.handler);
server.headersTimeout = 20_000;
server.requestTimeout = 60_000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${app.config.port} is already in use. Another copy of the server is probably still running; close it (or the other terminal) and try again.`);
  else console.error(err);
  process.exit(1);
});

server.listen(app.config.port, () => {
  const { production, port, cookieSecure, publicOrigin, resendApiKey } = app.config;
  console.log(`Anonymous server listening on http://localhost:${port} (${production ? 'production' : 'development'})`);
  if (production) {
    if (!cookieSecure) console.warn('Warning: COOKIE_SECURE=0, so sign-in cookies can travel over plain HTTP.');
    if (!publicOrigin) console.warn('Warning: PUBLIC_ORIGIN is not set. Password-reset emails will not be sent.');
    if (!resendApiKey) console.warn('Warning: no email provider is configured. Password-reset emails will not be sent.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(); app.close(); process.exit(0); });
}
