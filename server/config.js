import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

export function loadConfig(overrides = {}) {
  const env = process.env;
  const production = env.NODE_ENV === 'production';
  return {
    production,
    port: Number(env.PORT) || 8787,
    dataDir: env.DATA_DIR || path.join(root, 'data'),
    distDir: path.join(root, 'dist'),
    // Secure cookies need HTTPS. On by default in production.
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : production,
    // Only set when the server sits behind a reverse proxy you control.
    trustProxy: env.TRUST_PROXY === '1',
    // e.g. https://anonymous.example — used for links in email and origin checks.
    publicOrigin: (env.PUBLIC_ORIGIN || '').replace(/\/$/, ''),
    scryptN: Number(env.SCRYPT_N) || 2 ** 17,
    resendApiKey: env.RESEND_API_KEY || '',
    mailFrom: env.MAIL_FROM || '',
    quiet: false,
    ...overrides,
  };
}

export { INTERESTS, REPORT_REASONS, LIMITS } from '../shared/constants.js';
