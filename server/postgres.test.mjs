import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { createPgConfig } from '@electric-sql/pglite/node-postgres';
import { createApp } from './app.mjs';
import { createPostgresDatabase } from './postgres-database.mjs';

const PASSWORD = 'Disposable-Postgres-Test-2026!';
const ROOM = '/rooms/travel-questions';
const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');

// The pg driver uses PostgreSQL's wire protocol against an isolated PGlite DB.
// No DATABASE_URL or external server is consulted by this test suite.
async function harness(t, options = {}) {
  const engine = new PGlite();
  let app;
  let pool;
  t.after(async () => {
    if (app) await app.close();
    else if (pool) await pool.end();
    await engine.close();
  });
  await engine.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await engine.exec(schema);
  await engine.exec('SET ROLE kj_trail_backend;');
  const config = createPgConfig(engine);
  const parse = config.connection.parse.bind(config.connection);
  // pg supplies a result-parser object in Query.types. Its network serializer
  // ignores that object when writing parameter OIDs; PGlite 0.5.16 assumes an
  // array here. Match pg's wire serialization without changing result parsing.
  config.connection.parse = query => parse({ ...query, types: Array.isArray(query.types) ? query.types : undefined });
  pool = new pg.Pool({ ...config, max: 1 });
  const database = createPostgresDatabase({ pool });
  const errors = [];
  app = createApp({ database, onError: error => errors.push(error), ...options });
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;

  function client() {
    let cookie = '';
    return {
      get cookie() { return cookie; },
      set cookie(value) { cookie = value; },
      async call(path, { method = 'GET', body, headers = {} } = {}) {
        const response = await fetch(`${base}/api${path}`, {
          method,
          signal: AbortSignal.timeout(15000),
          headers: {
            ...(cookie ? { Cookie: cookie } : {}),
            ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: base } : {}),
            ...headers,
          },
          ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return { status: response.status, body: await response.json(), headers: response.headers };
      },
    };
  }

  const read = (sql, ...values) => database.request({ write: false }, () => database.prepare(sql).get(...values));
  const write = (sql, ...values) => database.request({ write: true }, () => database.prepare(sql).run(...values));
  async function actor(username, role = 'member') {
    const c = client();
    const user = ok(await post(c, '/auth/register', {
      username, displayName: username, password: PASSWORD, role: 'admin',
    })).user;
    if (role !== 'member') await write('UPDATE users SET role=?,version=version+1 WHERE id=?', role, user.id);
    return { c, user: ok(await c.call('/session')).user };
  }
  return { app, engine, database, errors, base, client, actor, read, write };
}

function ok(response, expected = 200) {
  assert.equal(response.status, expected, JSON.stringify(response.body));
  return response.body;
}
const post = (client, path, body = {}) => client.call(path, { method: 'POST', body });
const patch = (client, path, body) => client.call(path, { method: 'PATCH', body });
const send = (client, body, key) => post(client, `${ROOM}/messages`, { body, clientMessageId: key });

test('PostgreSQL auth uses backend RLS role, persists hashed sessions, and preserves response types', async t => {
  const h = await harness(t);
  assert.equal((await h.read('SELECT current_user AS "userName"')).userName, 'kj_trail_backend');
  const parameterCheck = await h.read("SELECT '?' AS literal, $$?$$ AS dollar, ?::text AS bound /* ? */", "apostrophe' stays data");
  assert.deepEqual(parameterCheck, { literal: '?', dollar: '?', bound: "apostrophe' stays data" });
  await assert.rejects(h.read('SELECT 9007199254740993::bigint AS oversized'), /safe integer range/);
  const c = h.client();
  const health = ok(await c.call('/health'));
  assert.equal(health.storage, 'postgresql');
  assert.equal(health.transport, 'authorized-polling');
  assert.deepEqual(ok(await c.call('/courses')).courses, []);
  assert.equal((await h.read('SELECT count(*) AS count FROM users')).count, 0);
  const user = ok(await post(c, '/auth/register', {
    username: 'Alice', displayName: '앨리스', password: PASSWORD, role: 'admin',
  })).user;
  assert.equal(user.username, 'alice');
  assert.equal(user.role, 'member');
  assert.equal(user.suspended, false);
  assert.equal(user.version, 1);
  ok(await c.call('/admin/users'), 403);
  const stored = await h.read('SELECT * FROM users WHERE id=?', user.id);
  assert.equal(stored.password_hash.length, 128);
  assert.notEqual(stored.password_hash, PASSWORD);
  const session = await h.read('SELECT * FROM sessions WHERE user_id=?', user.id);
  assert.equal(typeof session.expires_at, 'number');
  assert.equal(session.token_hash.length, 64);
  assert.notEqual(session.token_hash, c.cookie.split('=')[1]);
  const login = await post(c, '/auth/login', { username: 'ALICE', password: PASSWORD });
  ok(login);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  const previousCookie = c.cookie;
  ok(await post(c, '/auth/logout'));
  c.cookie = previousCookie;
  assert.equal(ok(await c.call('/session')).user, null);
  ok(await post(c, '/posts', { title: 'x', body: 'y' }), 401);
  ok(await post(c, '/auth/login', { username: 'alice', password: 'wrong' }), 401);
  ok(await post(c, '/auth/register', { username: 'ALICE', displayName: 'duplicate', password: PASSWORD }), 409);
  assert.deepEqual(h.errors, []);
});

test('PostgreSQL chat excludes pre-join messages across seq 9 to 10 and deduplicates concurrent retries', async t => {
  const h = await harness(t, { now: () => Date.parse('2026-11-13T08:00:00.000Z') });
  const sender = await h.actor('chat-sender');
  const reader = await h.actor('chat-reader');
  ok(await reader.c.call(`${ROOM}/messages`), 403);
  ok(await post(sender.c, `${ROOM}/join`));
  for (let i = 1; i <= 9; i++) ok(await send(sender.c, `Earlier message ${i}`, `earlier-message-${i}`));
  ok(await post(reader.c, `${ROOM}/join`));
  const membership = await h.read('SELECT joined_after_seq FROM memberships WHERE room_id=? AND user_id=?', 'travel-questions', reader.user.id);
  assert.equal(membership.joined_after_seq, 9);
  assert.deepEqual(ok(await reader.c.call(`${ROOM}/messages`)).messages, []);
  const first = ok(await send(reader.c, 'First eligible message', 'concurrent-retry-010')).message;
  const replies = await Promise.all([
    send(reader.c, 'First eligible message', 'concurrent-retry-010'),
    send(reader.c, 'First eligible message', 'concurrent-retry-010'),
  ]);
  for (const reply of replies) assert.equal(ok(reply).message.id, first.id);
  assert.equal((await h.read('SELECT count(*) AS count FROM messages')).count, 10);
  assert.equal((await h.read('SELECT seq FROM messages WHERE id=?', first.id)).seq, 10);
  ok(await send(reader.c, 'Changed payload', 'concurrent-retry-010'), 409);
  ok(await post(reader.c, '/rooms/community-lounge/join'));
  ok(await post(reader.c, '/rooms/community-lounge/messages', { body: 'First eligible message', clientMessageId: 'concurrent-retry-010' }), 409);
  assert.deepEqual(ok(await reader.c.call(`${ROOM}/messages`)).messages.map(message => message.id), [first.id]);
  ok(await post(reader.c, `${ROOM}/join`));
  assert.equal(ok(await reader.c.call(`${ROOM}/messages`)).messages.length, 1);
  ok(await reader.c.call(`${ROOM}/membership`, { method: 'DELETE' }));
  ok(await reader.c.call(`${ROOM}/messages`), 403);
  ok(await post(reader.c, `${ROOM}/join`));
  assert.deepEqual(ok(await reader.c.call(`${ROOM}/messages`)).messages, []);
  assert.deepEqual(h.errors, []);
});

test('PostgreSQL room changes reject stale versions and suspension revokes an existing session', async t => {
  const h = await harness(t);
  const member = await h.actor('active-member');
  const admin = await h.actor('room-admin', 'admin');
  ok(await post(member.c, `${ROOM}/join`));
  const original = ok(await send(member.c, 'Saved before lock', 'before-lock-001')).message;
  const locks = await Promise.all([
    post(admin.c, '/admin/rooms/travel-questions/lock', { locked: true, version: 1, reason: 'First concurrent update' }),
    post(admin.c, '/admin/rooms/travel-questions/lock', { locked: true, version: 1, reason: 'Second concurrent update' }),
  ]);
  assert.deepEqual(locks.map(response => response.status).sort(), [200, 409]);
  assert.equal(ok(await member.c.call('/rooms')).rooms.find(room => room.id === 'travel-questions').locked, true);
  assert.equal(ok(await send(member.c, 'Saved before lock', 'before-lock-001')).message.id, original.id);
  ok(await send(member.c, 'New while locked', 'after-lock-001'), 423);
  const savedCookie = member.c.cookie;
  ok(await patch(admin.c, `/admin/users/${member.user.id}`, { suspended: true, version: member.user.version, reason: 'Test suspension' }));
  member.c.cookie = savedCookie;
  assert.equal(ok(await member.c.call('/session')).user, null);
  ok(await send(member.c, 'Revoked session', 'revoked-session-001'), 401);
  const suspended = await h.read('SELECT suspended,version FROM users WHERE id=?', member.user.id);
  assert.equal(suspended.suspended, 1);
  ok(await patch(admin.c, `/admin/users/${member.user.id}`, { suspended: false, version: suspended.version, reason: 'Test restoration' }));
  assert.equal(ok(await member.c.call('/session')).user, null);
  ok(await post(member.c, '/auth/login', { username: 'active-member', password: PASSWORD }));
  assert.equal(ok(await member.c.call('/session')).user.suspended, false);
  assert.deepEqual(h.errors, []);
});

test('PostgreSQL posts, comments, block upserts, reports, and audit aliases follow the HTTP contract', async t => {
  const h = await harness(t);
  const author = await h.actor('post-author');
  const reader = await h.actor('post-reader');
  const admin = await h.actor('post-admin', 'admin');
  const postRecord = ok(await post(author.c, '/posts', { title: 'Test post', body: 'Isolated PostgreSQL content' })).post;
  const comment = ok(await post(author.c, `/posts/${postRecord.id}/comments`, { body: 'Comment to moderate' })).comment;
  const visible = ok(await reader.c.call('/posts')).posts[0];
  assert.equal(visible.authorId, author.user.id);
  assert.equal(visible.comments[0].id, comment.id);
  assert.equal(visible.comments[0].authorId, author.user.id);
  ok(await post(reader.c, '/blocks', { userId: author.user.id }));
  ok(await post(reader.c, '/blocks', { userId: author.user.id }));
  assert.deepEqual(ok(await reader.c.call('/blocks')).blocks, [{ userId: author.user.id, displayName: 'post-author' }]);
  assert.deepEqual(ok(await reader.c.call('/posts')).posts, []);
  ok(await reader.c.call(`/blocks/${author.user.id}`, { method: 'DELETE' }));
  const report = ok(await post(reader.c, '/reports', { targetType: 'comment', targetId: comment.id, reason: 'Test report' })).report;
  ok(await post(admin.c, `/admin/reports/${report.id}/resolve`, { action: 'hide', reason: 'Test moderation', version: 1 }));
  assert.deepEqual(ok(await reader.c.call('/posts')).posts[0].comments, []);
  ok(await post(admin.c, `/admin/reports/${report.id}/resolve`, { action: 'restore', reason: 'Stale screen', version: 1 }), 409);
  ok(await post(admin.c, `/admin/reports/${report.id}/resolve`, { action: 'restore', reason: 'Reviewed again', version: 2 }));
  assert.equal(ok(await reader.c.call('/posts')).posts[0].comments[0].id, comment.id);
  const audit = ok(await admin.c.call('/admin/audit')).entries;
  assert.equal(audit.length, 2);
  assert.equal(audit[0].actorId, admin.user.id);
  assert.equal(audit[0].targetId, comment.id);
  assert.equal(JSON.parse(audit[0].detailsJson).reportId, report.id);
  assert.ok(audit[0].createdAt.endsWith('Z'));
  ok(await post(reader.c, '/feedback', { category: 'test', body: 'Private review note' }));
  ok(await reader.c.call('/admin/feedback'), 403);
  assert.equal(ok(await admin.c.call('/admin/feedback')).feedback[0].authorId, reader.user.id);
  assert.deepEqual(h.errors, []);
});

test('PostgreSQL audit failure rolls back content hiding and report status in the same transaction', async t => {
  const h = await harness(t);
  const author = await h.actor('rollback-author');
  const reader = await h.actor('rollback-reader');
  const admin = await h.actor('rollback-admin', 'admin');
  const postRecord = ok(await post(author.c, '/posts', { title: 'Rollback fixture', body: 'Must stay visible' })).post;
  const report = ok(await post(reader.c, '/reports', { targetType: 'post', targetId: postRecord.id, reason: 'Rollback exercise' })).report;
  await h.engine.exec(`
    RESET ROLE;
    CREATE FUNCTION kj_trail.fail_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = 'report.hide' THEN RAISE EXCEPTION 'isolated audit failure'; END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER fail_test_audit BEFORE INSERT ON kj_trail.audit
    FOR EACH ROW EXECUTE FUNCTION kj_trail.fail_test_audit();
    SET ROLE kj_trail_backend;
  `);
  ok(await post(admin.c, `/admin/reports/${report.id}/resolve`, { action: 'hide', reason: 'Inject audit failure', version: 1 }), 500);
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0].message, /isolated audit failure/);
  assert.equal((await h.read('SELECT hidden FROM posts WHERE id=?', postRecord.id)).hidden, 0);
  const unchanged = await h.read('SELECT status,version FROM reports WHERE id=?', report.id);
  assert.equal(unchanged.status, 'open');
  assert.equal(unchanged.version, 1);
  assert.equal(ok(await reader.c.call('/posts')).posts[0].id, postRecord.id);
  assert.equal((await h.read('SELECT count(*) AS count FROM audit')).count, 0);
});

test('PostgreSQL course updates enforce optimistic versions and preserve append-only review history', async t => {
  const clock = Date.parse('2026-11-13T08:00:00.000Z');
  const h = await harness(t, { now: () => clock });
  const admin = await h.actor('course-admin', 'admin');
  const course = {
    title: 'Isolated review material', summary: 'This record only exists in the test database.',
    startPoint: 'Test start', durationMinutes: 70, difficulty: 'easy', themes: ['nature'],
    sourceUrl: 'https://example.org/test-evidence', fetchedAt: new Date(clock).toISOString(),
    sourceEffectiveAt: null, condition: 'unknown', conditionValidUntil: null,
    translationStatus: 'pending', status: 'draft', reason: 'Test creation',
    translations: {
      en: { title: 'Test title', summary: 'Test summary', startPoint: 'Test start' },
      'zh-TW': { title: '測試標題', summary: '測試說明', startPoint: '測試起點' },
    },
  };
  const draft = ok(await post(admin.c, '/admin/courses', course)).course;
  const changes = await Promise.all([
    patch(admin.c, `/admin/courses/${draft.id}`, { version: 1, title: 'First editor', reason: 'Concurrent edit one' }),
    patch(admin.c, `/admin/courses/${draft.id}`, { version: 1, title: 'Second editor', reason: 'Concurrent edit two' }),
  ]);
  assert.deepEqual(changes.map(response => response.status).sort(), [200, 409]);
  assert.equal((await h.read('SELECT count(*) AS count FROM course_versions WHERE course_id=?', draft.id)).count, 2);
  const approved = ok(await patch(admin.c, `/admin/courses/${draft.id}`, {
    version: 2, status: 'published', approve: true, translationStatus: 'approved',
    condition: 'open', conditionValidUntil: new Date(clock + 60000).toISOString(), reason: 'Explicit test approval',
  })).course;
  assert.equal(approved.version, 3);
  const publicCourse = ok(await h.client().call('/courses')).courses[0];
  assert.equal(publicCourse.id, draft.id);
  assert.equal(publicCourse.reviewer, null);
  assert.equal(publicCourse.recommendationEligible, true);
  assert.equal((await h.read('SELECT count(*) AS count FROM course_versions WHERE course_id=?', draft.id)).count, 3);
  await assert.rejects(h.write('UPDATE audit SET reason=?', 'tampered'), /permission denied|append-only/);
  await assert.rejects(h.write('DELETE FROM course_versions WHERE course_id=?', draft.id), /permission denied|append-only/);
  const invalidated = ok(await patch(admin.c, `/admin/courses/${draft.id}`, { version: 3, summary: 'Changed test text', reason: 'Source changed' })).course;
  assert.equal(invalidated.status, 'draft');
  assert.equal(invalidated.translationStatus, 'pending');
  assert.deepEqual(ok(await h.client().call('/courses')).courses, []);
  assert.deepEqual(h.errors, []);
});

test('PostgreSQL savepoints recover from a caught database failure and reads cannot mutate data', async t => {
  const h = await harness(t);
  const roomId = 'travel-questions';
  const original = await h.read('SELECT name,description,locked FROM rooms WHERE id=?', roomId);
  await h.database.request({ write: true }, async () => {
    await h.database.prepare('UPDATE rooms SET name=? WHERE id=?').run('Committed outer change', roomId);
    await assert.rejects(h.database.transaction(async () => {
      await h.database.prepare('UPDATE rooms SET description=? WHERE id=?').run('Must roll back', roomId);
      // A real PostgreSQL constraint error aborts the nested transaction.
      await h.database.prepare('UPDATE rooms SET locked=7 WHERE id=?').run(roomId);
    }), error => error.code === '23514');
    const room = await h.database.prepare('SELECT name,description,locked FROM rooms WHERE id=?').get(roomId);
    assert.deepEqual(room, { ...original, name: 'Committed outer change' });
    await h.database.transaction(() => h.database.prepare('UPDATE rooms SET description=? WHERE id=?').run('Committed nested change', roomId));
  });
  const committed = await h.read('SELECT name,description,locked FROM rooms WHERE id=?', roomId);
  assert.deepEqual(committed, { name: 'Committed outer change', description: 'Committed nested change', locked: 0 });
  await assert.rejects(h.database.request({ write: false }, () => h.database.prepare('UPDATE rooms SET locked=1 WHERE id=?').run(roomId)), error => error.code === '25006');
  await assert.rejects(h.database.request({ write: false }, () => h.database.transaction(() => { throw new Error('Must not run'); })), /read-only database request/);
  assert.deepEqual(await h.read('SELECT name,description,locked FROM rooms WHERE id=?', roomId), committed);
  assert.deepEqual(h.errors, []);
});
