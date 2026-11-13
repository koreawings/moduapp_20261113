import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createApp } from '../server/app.mjs';
import { openAppDatabase } from '../server/app-database.mjs';
import { createVercelHandler } from '../server/vercel.mjs';

const PASSWORD = 'Isolated-Vercel-Test-2026!';
const DEPLOYMENT = 'kj-trail-deployment.vercel.app';
const PRODUCTION = 'kj-trail.vercel.app';
const CUSTOM = 'trail.example.test';
const BRANCH = 'kj-trail-git-feature.vercel.app';
const ENV = {
  VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: DEPLOYMENT,
  VERCEL_PROJECT_PRODUCTION_URL: PRODUCTION, VERCEL_BRANCH_URL: BRANCH,
  APP_ORIGIN: `https://${CUSTOM}`,
  DATABASE_URL: 'postgresql://test:never-used@db.example.invalid/trail',
};

// Exercise the real Node request/response handler over local HTTP while sending
// the HTTPS Host and Origin headers that Vercel forwards to its function.
// All data lives in isolated, in-memory SQLite; no real env or DB is consulted.
async function harness(t, { env = {}, beforeRequest, failFirstInitialization = false, forbidDatabase = false } = {}) {
  const databaseOptions = [];
  const applicationOptions = [];
  const databases = [];
  const apps = [];
  const errors = [];
  let closedDatabases = 0;
  const handler = createVercelHandler({
    env: { ...ENV, ...env },
    createDatabase(options) {
      databaseOptions.push(options);
      if (forbidDatabase) throw new Error('Database construction must not be attempted');
      const db = openAppDatabase({ dbPath: ':memory:' });
      databases.push(db);
      const close = db.close.bind(db);
      let closed = false;
      db.close = async () => {
        if (!closed) { closed = true; closedDatabases += 1; }
        return close();
      };
      if (failFirstInitialization && databaseOptions.length === 1) {
        db.ready = async () => { throw new Error('private-database-password-must-not-leak'); };
      }
      return db;
    },
    createApplication(options) {
      applicationOptions.push(options);
      const app = createApp({ ...options, onError: error => errors.push(error) });
      apps.push(app);
      return app;
    },
    attachPool() { throw new Error('An injected test database has no external pool'); },
  });
  const server = createServer(async (req, res) => {
    try {
      if (beforeRequest) await beforeRequest(req);
      await handler(req, res);
    } catch (error) {
      errors.push(error);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ unexpected: error.message }));
    }
  });
  t.after(async () => {
    const stopped = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await stopped;
    for (const app of apps) await app.close();
    for (const db of databases) await db.close();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  function send(path = '/api/health', { method = 'GET', host = PRODUCTION, body, raw, headers = {}, chunked = false } = {}) {
    const mutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
    const content = raw ?? (mutation ? JSON.stringify(body ?? {}) : undefined);
    return new Promise((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1', port, path, method,
        headers: {
          Host: host,
          ...(mutation ? { 'Content-Type': 'application/json', Origin: `https://${host}` } : {}),
          ...(content !== undefined && !chunked ? { 'Content-Length': Buffer.byteLength(content) } : {}),
          ...headers,
        },
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try { parsed = JSON.parse(text); } catch { parsed = text; }
          resolve({ status: res.statusCode, body: parsed, text, headers: res.headers });
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(8000, () => req.destroy(new Error('Isolated Vercel request timed out')));
      if (chunked && content !== undefined) {
        const bytes = Buffer.from(content);
        for (let offset = 0; offset < bytes.length; offset += 4096) req.write(bytes.subarray(offset, offset + 4096));
        req.end();
      } else req.end(content);
    });
  }
  return { send, databaseOptions, applicationOptions, databases, errors, get closedDatabases() { return closedDatabases; } };
}

function ok(response, status = 200) {
  assert.equal(response.status, status, response.text);
  return response.body;
}

test('Vercel warm requests share one app and HTTPS registration issues a secure session', async t => {
  const h = await harness(t);
  const responses = await Promise.all(Array.from({ length: 5 }, () => h.send()));
  for (const response of responses) assert.equal(ok(response).mode, 'hosted');
  assert.equal(h.databaseOptions.length, 1);
  assert.equal(h.applicationOptions.length, 1);
  assert.equal(h.databaseOptions[0].databaseUrl, ENV.DATABASE_URL);
  assert.equal(h.databaseOptions[0].maxConnections, 3);
  const registration = await h.send('/api/auth/register', {
    method: 'POST', body: { username: 'vercel-member', displayName: 'Vercel member', password: PASSWORD },
    headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': PRODUCTION },
  });
  const user = ok(registration).user;
  assert.equal(user.role, 'member');
  const cookie = registration.headers['set-cookie'][0];
  assert.match(cookie, /; Secure(?:;|$)/);
  assert.match(cookie, /; HttpOnly(?:;|$)/);
  assert.match(cookie, /; SameSite=Strict(?:;|$)/);
  assert.equal(registration.headers['cache-control'], 'no-store');
  const session = ok(await h.send('/api/session', { headers: { Cookie: cookie.split(';')[0] } }));
  assert.equal(session.user.id, user.id);
  assert.equal(h.applicationOptions.length, 1);
  assert.deepEqual(h.errors, []);
});

test('Vercel HTTPS allows exact deployment hosts and rejects Host, forwarded-host, and Origin spoofing', async t => {
  const h = await harness(t);
  for (const host of [PRODUCTION, DEPLOYMENT, CUSTOM, `${CUSTOM}:443`, CUSTOM.toUpperCase()]) {
    ok(await h.send('/api/health', { host }));
  }
  for (const host of ['evil.example.test', `${PRODUCTION}.evil.test`, BRANCH, `${CUSTOM}:444`, 'localhost']) {
    const response = await h.send('/api/health', { host, headers: { 'X-Forwarded-Host': PRODUCTION, 'X-Forwarded-Proto': 'https' } });
    ok(response, 403);
    assert.equal(response.body.code, 'invalid_host');
  }
  const mutation = { method: 'POST', body: {} };
  for (const headers of [
    { Origin: 'https://evil.example.test', 'X-Forwarded-Host': 'evil.example.test' },
    { Origin: `http://${PRODUCTION}`, 'X-Forwarded-Proto': 'http' },
    { Origin: `https://${CUSTOM}` },
    { Origin: `https://${PRODUCTION}.evil.test` },
    { Origin: 'null' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    const response = await h.send('/api/auth/logout', { ...mutation, headers });
    ok(response, 403);
    assert.equal(response.body.code, 'origin_rejected');
  }
  // Forwarded metadata never chooses the trusted browser Origin.
  ok(await h.send('/api/auth/logout', { ...mutation, headers: { 'X-Forwarded-Host': 'evil.example.test', 'X-Forwarded-Proto': 'http' } }));
  ok(await h.send('/api/auth/logout', { ...mutation, host: `${CUSTOM}:443`, headers: { Origin: `https://${CUSTOM}` } }));
  assert.deepEqual(h.errors, []);
});

test('Vercel preview trusts only that deployment and branch, excluding production and custom origins', async t => {
  const h = await harness(t, { env: { VERCEL_ENV: 'preview' } });
  for (const host of [DEPLOYMENT, BRANCH]) {
    ok(await h.send('/api/health', { host }));
    ok(await h.send('/api/auth/logout', { host, method: 'POST' }));
  }
  for (const host of [PRODUCTION, CUSTOM, 'another-preview.vercel.app', `${BRANCH}.evil.test`]) {
    ok(await h.send('/api/health', { host }), 403);
  }
  ok(await h.send('/api/auth/logout', { host: BRANCH, method: 'POST', headers: { Origin: `https://${DEPLOYMENT}` } }), 403);
  assert.deepEqual(h.errors, []);
});

test('Vercel reads raw JSON without touching its lazy body getter and bounds chunked request bytes', async t => {
  let bodyGetterReads = 0;
  const h = await harness(t, {
    beforeRequest(req) {
      Object.defineProperty(req, 'body', { get() { bodyGetterReads += 1; throw new Error('Vercel lazy body getter must not be accessed'); } });
    },
  });
  const registration = ok(await h.send('/api/auth/register', {
    method: 'POST', chunked: true, body: { username: 'stream-member', displayName: '스트림 시험', password: PASSWORD },
  }));
  assert.equal(registration.user.username, 'stream-member');
  ok(await h.send('/api/auth/logout', { method: 'POST', chunked: true, raw: '{invalid' }), 400);
  ok(await h.send('/api/auth/logout', { method: 'POST', chunked: true, raw: '[]' }), 400);
  ok(await h.send('/api/auth/logout', { method: 'POST', chunked: true, raw: 'null' }), 400);
  ok(await h.send('/api/auth/logout', { method: 'POST', raw: '{}', headers: { 'Content-Type': 'text/plain' } }), 415);
  const large = JSON.stringify({ text: '가'.repeat(12000) });
  assert.ok(Buffer.byteLength(large) > 32768);
  const oversized = await h.send('/api/auth/logout', { method: 'POST', chunked: true, raw: large });
  ok(oversized, 413);
  assert.equal(oversized.body.code, 'body_too_large');
  assert.equal(bodyGetterReads, 0);
  ok(await h.send('/api/health'));
  assert.deepEqual(h.errors, []);
});

test('Vercel requires DATABASE_URL and never silently constructs a SQLite application', async t => {
  const h = await harness(t, { env: { DATABASE_URL: '' }, forbidDatabase: true });
  const response = await h.send();
  ok(response, 503);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(h.databaseOptions.length, 0);
  assert.equal(h.applicationOptions.length, 0);
  assert.equal(response.text.includes('never-used'), false);
  assert.deepEqual(h.errors, []);
});

test('Vercel closes failed initialization, returns a safe 503, and retries the next request', async t => {
  const h = await harness(t, { failFirstInitialization: true });
  const failed = await h.send();
  ok(failed, 503);
  assert.equal(failed.text.includes('private-database-password'), false);
  assert.equal(h.closedDatabases, 1);
  assert.equal(h.applicationOptions.length, 0);
  ok(await h.send());
  ok(await h.send('/api/session'));
  assert.equal(h.databaseOptions.length, 2);
  assert.equal(h.applicationOptions.length, 1);
  assert.equal(h.closedDatabases, 1);
  const missingApi = await h.send('/api/does-not-exist');
  ok(missingApi, 404);
  assert.match(missingApi.headers['content-type'], /^application\/json/);
  assert.equal(missingApi.body.code, 'not_found');
  assert.deepEqual(h.errors, []);
});
