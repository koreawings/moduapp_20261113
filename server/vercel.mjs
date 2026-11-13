import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachDatabasePool } from '@vercel/functions';
import { createApp } from './app.mjs';
import { createPostgresDatabase } from './postgres-database.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function httpsOrigin(value, name) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`${name} must be a valid HTTPS origin.`); }
  const labels = url.hostname.split('.');
  const validHost = labels.length > 1 && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (url.protocol !== 'https:' || !validHost || isIP(url.hostname) || url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be a valid HTTPS origin.`);
  }
  return url.origin;
}

function deploymentOrigin(value, name) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[/:?#@\\]/.test(value)) {
    throw new Error(`${name} must contain an exact deployment hostname.`);
  }
  return httpsOrigin(`https://${value}`, name);
}

export function getVercelConfig(env, rootDir = ROOT) {
  if (typeof env.DATABASE_URL !== 'string' || !env.DATABASE_URL.trim()) {
    throw new Error('DATABASE_URL is required for the hosted application.');
  }
  if (!['preview', 'production'].includes(env.VERCEL_ENV)) {
    throw new Error('A Vercel preview or production environment is required.');
  }
  const origins = new Set([deploymentOrigin(env.VERCEL_URL, 'VERCEL_URL')]);
  if (env.VERCEL_ENV === 'production') {
    if (env.VERCEL_PROJECT_PRODUCTION_URL) origins.add(deploymentOrigin(env.VERCEL_PROJECT_PRODUCTION_URL, 'VERCEL_PROJECT_PRODUCTION_URL'));
    if (env.APP_ORIGIN) origins.add(httpsOrigin(env.APP_ORIGIN, 'APP_ORIGIN'));
  } else if (env.VERCEL_BRANCH_URL) {
    origins.add(deploymentOrigin(env.VERCEL_BRANCH_URL, 'VERCEL_BRANCH_URL'));
  }
  return {
    databaseUrl: env.DATABASE_URL.trim(),
    sslCaPath: resolve(rootDir, env.DATABASE_SSL_CA?.trim() || 'certs/supabase-ca.crt'),
    allowedOrigins: [...origins],
    allowedHosts: [...origins].map(origin => new URL(origin).host),
  };
}

// Vercel supplies this header. Ordinary X-Forwarded-For and Host are never
// used to establish trust or to expand the configured deployment allowlist.
function vercelClientIp(req) {
  const value = req.headers['x-vercel-forwarded-for'];
  return typeof value === 'string' && isIP(value.trim()) ? value.trim() : 'unknown';
}

export function createVercelHandler({ env = process.env, rootDir = ROOT,
  createDatabase = createPostgresDatabase, createApplication = createApp,
  attachPool = attachDatabasePool } = {}) {
  let pendingApp;
  function getApp() {
    pendingApp ??= (async () => {
      const config = getVercelConfig(env, rootDir);
      let database;
      try {
        database = createDatabase({ databaseUrl: config.databaseUrl, sslCaPath: config.sslCaPath,
          maxConnections: 3, onPool: attachPool });
        await database.ready();
        return await createApplication({ database, allowedHosts: config.allowedHosts, allowedOrigins: config.allowedOrigins,
          secureCookies: true, deploymentMode: 'hosted', clientIp: vercelClientIp,
          onError: () => console.error('[server] Hosted request failed.') });
      } catch (error) {
        try { await database?.close(); } catch { /* Preserve the initialization failure. */ }
        throw error;
      }
    })().catch(error => {
      pendingApp = undefined;
      throw error;
    });
    return pendingApp;
  }

  return async function handler(req, res) {
    try {
      const app = await getApp();
      await app.handleRequest(req, res);
    } catch {
      // Do not log connection strings, database error details or request data.
      console.error('[server] Hosted application unavailable. Check deployment configuration and database connectivity.');
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
          'Retry-After': '5', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify({ error: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', code: 'service_unavailable' }));
      } else if (!res.writableEnded) res.end();
    }
  };
}
