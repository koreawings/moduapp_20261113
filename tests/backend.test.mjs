import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../server/app.mjs';
import { grantAdmin, openDatabase } from '../server/database.mjs';

const PASSWORD = 'Isolated-Test-Password-2026!'; // Only temporary integration test accounts.
async function harness(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'kj-trail-test-'));
  const dbPath = join(directory, 'isolated.sqlite');
  const errors = []; const app = createApp({ dbPath, onError: error => errors.push(error), ...options });
  const address = await app.listen(0); const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  function client() {
    let cookie = '';
    return {
      get cookie() { return cookie; },
      set cookie(value) { cookie = value; },
      async call(path, { method = 'GET', body, headers = {} } = {}) {
        const response = await fetch(`${base}/api${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json', Origin: base } : {}), ...headers }, ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}) });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        return { status: response.status, body: await response.json(), headers: response.headers };
      },
      async register(username) { const response = await this.call('/auth/register', { method: 'POST', body: { username, displayName: username, password: PASSWORD, role: 'admin' } }); ok(response); return response.body.user; },
      async login(username) { const response = await this.call('/auth/login', { method: 'POST', body: { username, password: PASSWORD } }); ok(response); return response.body.user; },
    };
  }
  async function actor(username, role = 'member') {
    const c = client(); const user = await c.register(username);
    if (role === 'admin') grantAdmin(app.db, username);
    else if (role !== 'member') app.db.prepare('UPDATE users SET role=?,version=version+1 WHERE id=?').run(role, user.id);
    return { c, user: (await c.call('/session')).body.user };
  }
  return { app, dbPath, directory, base, client, actor, errors };
}
function ok(response, expected = 200) { assert.equal(response.status, expected, JSON.stringify(response.body)); return response.body; }
const post = (c, path, body = {}) => c.call(path, { method: 'POST', body });
const patch = (c, path, body) => c.call(path, { method: 'PATCH', body });
const roomId = 'travel-questions';
const roomPath = `/rooms/${roomId}`;
async function send(c, body, key) { return post(c, `${roomPath}/messages`, { body, clientMessageId: key }); }
function courseData(at, overrides = {}) {
  return { title: '테스트 전용 검수 자료', summary: '격리된 시험 DB 자료. 실제 코스가 아닙니다.', startPoint: '시험 출발지', durationMinutes: 70, difficulty: 'easy', themes: ['nature'], sourceUrl: 'https://example.org/test-evidence', fetchedAt: new Date(at).toISOString(), sourceEffectiveAt: null, condition: 'unknown', conditionValidUntil: null, translationStatus: 'pending', translations: { en: { title: 'Test review material', summary: 'Isolated test database material, not a real route.', startPoint: 'Test starting point' }, 'zh-TW': { title: '測試審核資料', summary: '隔離測試資料庫的資料，並非真實路線。', startPoint: '測試起點' } }, status: 'draft', reason: 'Isolated test setup', ...overrides };
}

test('operational database is empty; demo fixtures are explicit and separate; no default users', async t => {
  const h = await harness(t); const c = h.client();
  const health = ok(await c.call('/health')); assert.equal(health.mode, 'local'); assert.equal(health.transport, 'authorized-polling');
  assert.deepEqual(ok(await c.call('/courses')).courses, []);
  const demo = ok(await c.call('/courses?demo=1')); assert.equal(demo.fixture, true); assert.equal(demo.courses.length, 3);
  assert.ok(demo.courses.every(course => course.isFixture && !course.recommendationEligible && !course.reviewedAt));
  ok(await c.call(`/courses/${demo.courses[0].id}`), 404);
  assert.equal(ok(await c.call(`/courses/${demo.courses[0].id}?demo=1`)).fixture, true);
  assert.equal(h.app.db.prepare('SELECT count(*) n FROM users').get().n, 0);
  assert.equal(h.app.db.prepare('SELECT count(*) n FROM courses').get().n, 0);
  assert.equal(ok(await c.call('/session')).user, null);
});

test('registration ignores role injection; session is HttpOnly and only hashed tokens/passwords are stored', async t => {
  const h = await harness(t); const c = h.client(); const user = await c.register('alice');
  assert.equal(user.role, 'member'); assert.equal((await c.call('/admin/users')).status, 403);
  const row = h.app.db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  assert.notEqual(row.password_hash, PASSWORD); assert.equal(row.password_hash.length, 128); assert.equal(row.password_salt.length, 32);
  const session = h.app.db.prepare('SELECT * FROM sessions WHERE user_id=?').get(user.id);
  assert.notEqual(session.token_hash, c.cookie.split('=')[1]); assert.equal(session.token_hash.length, 64);
  const login = await post(c, '/auth/login', { username: 'ALICE', password: PASSWORD }); ok(login);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/); assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const previous = c.cookie; ok(await post(c, '/auth/logout'));
  c.cookie = previous; assert.equal(ok(await c.call('/session')).user, null); ok(await post(c, '/posts', { title: 'x', body: 'y' }), 401);
  ok(await post(c, '/auth/login', { username: 'alice', password: 'wrong' }), 401);
  ok(await post(c, '/auth/register', { username: 'bob', displayName: 'Bob', password: 'short' }), 400);
});

test('mutations reject cross-origin, cross-site, invalid content types and rebinding Host', async t => {
  const h = await harness(t); const c = h.client();
  ok(await post(c, '/auth/register', { username: 'origin-user', displayName: 'x', password: PASSWORD }), 200);
  ok(await c.call('/posts', { method: 'POST', body: { title: 'x', body: 'x' }, headers: { Origin: 'https://evil.example' } }), 403);
  ok(await c.call('/posts', { method: 'POST', body: { title: 'x', body: 'x' }, headers: { 'sec-fetch-site': 'cross-site' } }), 403);
  ok(await c.call('/posts', { method: 'POST', body: { title: 'x', body: 'x' }, headers: { 'Content-Type': 'text/plain' } }), 415);
  ok(await c.call('/posts', { method: 'POST', body: { title: 'x', body: 'x' }, headers: { 'Content-Type': 'application/json-fake' } }), 415);
  const status = await new Promise((resolve, reject) => { const req = httpRequest(`${h.base}/api/health`, { headers: { Host: 'attacker.example' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); });
  assert.equal(status, 403); assert.equal(h.app.db.prepare('SELECT count(*) n FROM posts').get().n, 0);
});

test('membership gates history; same-millisecond pre-join history and rejoin history stay excluded', async t => {
  const fixed = Date.now(); const h = await harness(t, { now: () => fixed });
  const a = await h.actor('member-a'); const b = await h.actor('member-b'); const outsider = h.client();
  ok(await outsider.call(`${roomPath}/messages`), 401); ok(await a.c.call(`${roomPath}/messages`), 403);
  ok(await post(a.c, `${roomPath}/join`)); ok(await send(a.c, 'Before B joined', 'before-b-0001'));
  ok(await post(b.c, `${roomPath}/join`)); assert.deepEqual(ok(await b.c.call(`${roomPath}/messages`)).messages, []);
  ok(await send(a.c, 'After B joined', 'after-b-0001'));
  assert.equal(ok(await b.c.call(`${roomPath}/messages`)).messages[0].body, 'After B joined');
  // A repeated join must not erase the current membership history.
  ok(await post(b.c, `${roomPath}/join`)); assert.equal(ok(await b.c.call(`${roomPath}/messages`)).messages.length, 1);
  ok(await b.c.call(`${roomPath}/membership`, { method: 'DELETE' })); ok(await b.c.call(`${roomPath}/messages`), 403);
  ok(await post(b.c, `${roomPath}/join`)); assert.deepEqual(ok(await b.c.call(`${roomPath}/messages`)).messages, []);
  assert.equal(ok(await b.c.call('/rooms')).rooms.find(r => r.id === roomId).joined, true);
});

test('durable chat retry returns one stored message; altered payload or room conflicts', async t => {
  const h = await harness(t); const a = await h.actor('sender'); ok(await post(a.c, `${roomPath}/join`));
  const first = ok(await send(a.c, 'durable hello', 'retry-test-001')).message;
  const attempts = await Promise.all([send(a.c, 'durable hello', 'retry-test-001'), send(a.c, 'durable hello', 'retry-test-001')]);
  assert.ok(attempts.every(result => ok(result).message.id === first.id));
  assert.equal(h.app.db.prepare('SELECT count(*) n FROM messages').get().n, 1);
  ok(await send(a.c, 'changed body', 'retry-test-001'), 409);
  ok(await post(a.c, '/rooms/community-lounge/join'));
  ok(await post(a.c, '/rooms/community-lounge/messages', { body: 'durable hello', clientMessageId: 'retry-test-001' }), 409);
  const restarted = createApp({ dbPath: h.dbPath });
  try { assert.equal(restarted.db.prepare('SELECT body FROM messages WHERE id=?').get(first.id).body, 'durable hello'); } finally { await restarted.close(); }
  assert.equal(ok(await a.c.call(`${roomPath}/messages`)).messages.length, 1);
});

test('block filtering is enforced by server and unblock restores authorized messages', async t => {
  const h = await harness(t); const a = await h.actor('block-a'); const b = await h.actor('block-b');
  for (const c of [a.c, b.c]) ok(await post(c, `${roomPath}/join`));
  ok(await send(a.c, 'visible message', 'block-test-001')); assert.equal(ok(await b.c.call(`${roomPath}/messages`)).messages.length, 1);
  ok(await post(b.c, '/blocks', { userId: a.user.id })); assert.deepEqual(ok(await b.c.call(`${roomPath}/messages`)).messages, []);
  assert.deepEqual(ok(await b.c.call('/blocks')).blocks, [{ userId: a.user.id, displayName: 'block-a' }]);
  ok(await b.c.call(`/blocks/${a.user.id}`, { method: 'DELETE' })); assert.equal(ok(await b.c.call(`${roomPath}/messages`)).messages.length, 1);
  ok(await post(a.c, '/blocks', { userId: a.user.id }), 400);
});

test('admin hide/restore removes content from each authorized snapshot; stale reports conflict', async t => {
  const h = await harness(t); const a = await h.actor('report-a'); const b = await h.actor('report-b'); const admin = await h.actor('report-admin', 'admin');
  for (const c of [a.c, b.c]) ok(await post(c, `${roomPath}/join`));
  const message = ok(await send(a.c, 'report this sample', 'report-test-01')).message;
  const report = ok(await post(b.c, '/reports', { targetType: 'message', targetId: message.id, reason: '시험 신고' })).report;
  ok(await b.c.call('/admin/reports'), 403);
  const listed = ok(await admin.c.call('/admin/reports')).reports[0]; assert.equal(listed.targetPreview, message.body); assert.equal(listed.version, 1);
  ok(await post(admin.c, `/admin/reports/${report.id}/resolve`, { action: 'hide', reason: '검토 숨김', version: 1 }));
  assert.deepEqual(ok(await b.c.call(`${roomPath}/messages`)).messages, []);
  ok(await post(admin.c, `/admin/reports/${report.id}/resolve`, { action: 'restore', reason: '오래된 요청', version: 1 }), 409);
  ok(await post(admin.c, `/admin/reports/${report.id}/resolve`, { action: 'restore', reason: '복구 검토', version: 2 }));
  assert.equal(ok(await b.c.call(`${roomPath}/messages`)).messages[0].id, message.id);
  const entries = ok(await admin.c.call('/admin/audit')).entries; assert.equal(entries.filter(e => e.targetId === message.id).length, 2);
});

test('failed audit insert rolls back moderation action and report state atomically', async t => {
  const h = await harness(t); const a = await h.actor('atomic-a'); const admin = await h.actor('atomic-admin', 'admin');
  const p = ok(await post(a.c, '/posts', { title: 'audit rollback', body: 'must remain visible' })).post;
  const report = ok(await post(a.c, '/reports', { targetType: 'post', targetId: p.id, reason: 'isolated test' })).report;
  h.app.db.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit WHEN NEW.action='report.hide' BEGIN SELECT RAISE(ABORT,'test audit unavailable'); END;");
  ok(await post(admin.c, `/admin/reports/${report.id}/resolve`, { action: 'hide', reason: 'atomic test', version: 1 }), 500);
  assert.equal(h.app.db.prepare('SELECT hidden FROM posts WHERE id=?').get(p.id).hidden, 0);
  assert.equal(h.app.db.prepare('SELECT version FROM reports WHERE id=?').get(report.id).version, 1);
  assert.equal(h.app.db.prepare("SELECT count(*) n FROM audit WHERE action='report.hide'").get().n, 0);
  assert.equal(h.errors.length, 1);
});

test('locked rooms reject writes immediately; suspension revokes prior session; operator role is rechecked', async t => {
  const h = await harness(t); const a = await h.actor('revoke-a'); const admin = await h.actor('revoke-admin', 'admin'); const mod = await h.actor('revoke-mod', 'moderator');
  ok(await post(a.c, `${roomPath}/join`)); ok(await send(a.c, 'before lock', 'revoke-test-001'));
  ok(await post(admin.c, `/admin/rooms/${roomId}/lock`, { locked: true, reason: 'local test lock', version: 1 }));
  assert.equal(ok(await send(a.c, 'before lock', 'revoke-test-001')).duplicate, true); // Stored ACK remains valid during a lock.
  ok(await send(a.c, 'after lock', 'revoke-test-002'), 423);
  assert.equal(ok(await a.c.call(`${roomPath}/messages`)).messages.length, 1); // Lock is read-only, not retroactive history erasure.
  ok(await post(admin.c, `/admin/rooms/${roomId}/lock`, { locked: false, reason: 'stale', version: 1 }), 409);
  ok(await post(admin.c, `/admin/rooms/${roomId}/lock`, { locked: false, reason: 'unlock', version: 2 }));
  ok(await patch(admin.c, `/admin/users/${a.user.id}`, { suspended: true, reason: 'suspension test', version: a.user.version }));
  ok(await a.c.call(`${roomPath}/messages`), 401); ok(await send(a.c, 'revoked', 'revoke-test-003'), 401);
  ok(await post(a.c, '/auth/login', { username: 'revoke-a', password: PASSWORD }), 403);
  ok(await mod.c.call('/admin/users'));
  h.app.db.prepare("UPDATE users SET role='member',version=version+1 WHERE id=?").run(mod.user.id);
  ok(await mod.c.call('/admin/users'), 403);
  ok(await patch(admin.c, `/admin/users/${admin.user.id}`, { suspended: true, reason: 'self', version: admin.user.version }), 403);
});

test('content and moderation capabilities remain separate; admin has no public role assignment API', async t => {
  const h = await harness(t); const editor = await h.actor('content-user', 'content'); const mod = await h.actor('moderator-user', 'moderator');
  ok(await editor.c.call('/admin/courses')); ok(await editor.c.call('/admin/users'), 403); ok(await editor.c.call('/admin/reports'), 403); ok(await editor.c.call('/admin/audit'), 403);
  ok(await mod.c.call('/admin/reports')); ok(await mod.c.call('/admin/courses'), 403); ok(await mod.c.call('/admin/audit'), 403);
  ok(await post(editor.c, '/admin/roles', { userId: editor.user.id, role: 'admin' }), 404);
  assert.equal(ok(await editor.c.call('/admin/overview')).counts.users, null);
});

test('course publishing requires explicit evidence approval; changes invalidate review; eligibility expires', async t => {
  let clock = Date.now(); const h = await harness(t, { now: () => clock }); const admin = await h.actor('course-admin', 'admin'); const publicClient = h.client();
  const denied = courseData(clock, { status: 'published', translationStatus: 'approved', reviewedAt: new Date(clock).toISOString(), reviewer: 'forged' });
  ok(await post(admin.c, '/admin/courses', denied), 400);
  ok(await post(admin.c, '/admin/courses', { ...courseData(clock), isFixture: true, approve: true }), 400);
  ok(await post(admin.c, '/admin/courses', { ...courseData(clock), approve: true, sourceUrl: '', translationStatus: 'approved', status: 'published' }), 400);
  ok(await post(admin.c, '/admin/courses', { ...courseData(clock), fetchedAt: new Date(clock + 1000).toISOString() }), 400);
  const draft = ok(await post(admin.c, '/admin/courses', courseData(clock))).course;
  assert.deepEqual(ok(await publicClient.call('/courses')).courses, []);
  const published = ok(await patch(admin.c, `/admin/courses/${draft.id}`, { version: draft.version, status: 'published', approve: true, translationStatus: 'approved', reason: 'verified in isolated test', condition: 'open', conditionValidUntil: new Date(clock + 60000).toISOString(), reviewer: 'forged', reviewedAt: '2000-01-01T00:00:00Z' })).course;
  assert.equal(published.reviewer, 'course-admin'); assert.equal(published.reviewedAt, new Date(clock).toISOString()); assert.equal(published.recommendationEligible, true);
  const publicCourses = ok(await publicClient.call('/courses')).courses;
  assert.equal(publicCourses.length, 1); assert.equal(publicCourses[0].reviewer, null); assert.equal(publicCourses[0].reviewed, true); assert.ok(!JSON.stringify(publicCourses).includes('course-admin'));
  clock += 120000;
  const expired = ok(await publicClient.call(`/courses/${draft.id}`)).course;
  assert.equal(expired.recommendationEligible, false); assert.equal(expired.condition, 'unknown'); assert.equal(expired.lastKnownCondition, 'open');
  assert.equal(ok(await publicClient.call('/courses')).courses[0].condition, 'unknown');
  ok(await patch(admin.c, `/admin/courses/${draft.id}`, { version: 1, reason: 'stale' }), 409);
  const bypass = await patch(admin.c, `/admin/courses/${draft.id}`, { version: published.version, summary: 'changed and attempting to inherit approval', approve: true, reason: 'must not inherit translation approval' });
  ok(bypass, 409); assert.equal(bypass.body.code, 'content_changed_review_required');
  assert.equal(h.app.db.prepare('SELECT version FROM courses WHERE id=?').get(draft.id).version, published.version);
  const changed = ok(await patch(admin.c, `/admin/courses/${draft.id}`, { version: published.version, summary: 'Changed source facts', reason: 'requires new review' })).course;
  assert.equal(changed.status, 'draft'); assert.equal(changed.translationStatus, 'pending'); assert.equal(changed.reviewedAt, null);
  assert.deepEqual(ok(await publicClient.call('/courses')).courses, []);
  assert.equal(h.app.db.prepare('SELECT count(*) n FROM course_versions WHERE course_id=?').get(draft.id).n, 3);
  const republished = ok(await patch(admin.c, `/admin/courses/${draft.id}`, { version: changed.version, approve: true, translationStatus: 'approved', condition: 'unknown', status: 'published', reason: 'separate new approval' })).course;
  const evidenceChange = ok(await patch(admin.c, `/admin/courses/${draft.id}`, { version: republished.version, condition: 'open', conditionValidUntil: new Date(clock + 3600000).toISOString(), reason: 'new condition requires review' })).course;
  assert.equal(evidenceChange.status, 'draft'); assert.equal(evidenceChange.reviewedAt, null); assert.equal(evidenceChange.recommendationEligible, false);
});

test('board and comments persist author from session, bounded inputs, private feedback access', async t => {
  const h = await harness(t); const member = await h.actor('board-user'); const admin = await h.actor('board-admin', 'admin'); const guest = h.client();
  const p = ok(await post(member.c, '/posts', { title: "'; DROP TABLE users; --", body: '<script>not executable JSON</script>', authorId: admin.user.id })).post;
  assert.equal(p.authorId, member.user.id); assert.equal(p.body, '<script>not executable JSON</script>');
  const comment = ok(await post(member.c, `/posts/${p.id}/comments`, { body: 'reply', authorId: admin.user.id })).comment; assert.equal(comment.authorId, member.user.id);
  assert.equal(ok(await guest.call('/posts')).posts[0].comments.length, 1);
  ok(await post(guest, '/posts', { title: 'guest', body: 'no' }), 401);
  ok(await post(member.c, '/posts', { title: '', body: 'invalid' }), 400);
  ok(await post(member.c, '/feedback', { category: 'usability', body: 'Actual isolated test feedback' }));
  ok(await guest.call('/feedback'), 404); ok(await member.c.call('/admin/feedback'), 403);
  assert.equal(ok(await admin.c.call('/admin/feedback')).feedback[0].body, 'Actual isolated test feedback');
});

test('expired sessions stop working and chat burst rate limits preserve idempotent retries', async t => {
  let clock = Date.now(); const h = await harness(t, { now: () => clock, sessionTtlMs: 60000 }); const a = await h.actor('limits-user');
  ok(await post(a.c, `${roomPath}/join`));
  for (let i = 0; i < 30; i++) ok(await send(a.c, `message ${i}`, `burst-test-${String(i).padStart(3, '0')}`));
  ok(await send(a.c, 'message 0', 'burst-test-000')); // An ACK retry is not another write.
  ok(await send(a.c, 'over limit', 'burst-test-031'), 429);
  clock += 60001; assert.equal(ok(await a.c.call('/session')).user, null); ok(await a.c.call(`${roomPath}/messages`), 401);
});

test('member cannot report a private message from a room they have not joined', async t => {
  const h = await harness(t); const a = await h.actor('private-a'); const b = await h.actor('private-b');
  ok(await post(a.c, `${roomPath}/join`)); const message = ok(await send(a.c, 'private membership content', 'private-test-001')).message;
  ok(await post(b.c, '/reports', { targetType: 'message', targetId: message.id, reason: 'guessed message' }), 403);
  assert.equal(h.app.db.prepare('SELECT count(*) n FROM reports').get().n, 0);
});

test('translation approval binds actual required locale text to the current source and invalidates edits', async t => {
  const at = Date.now(); const h = await harness(t, { now: () => at }); const editor = await h.actor('translation-editor', 'content'); const guest = h.client();
  for (const translations of [{}, { en: courseData(at).translations.en }, { ...courseData(at).translations, 'zh-TW': { title: '測試', summary: '測試', startPoint: '' } }]) {
    ok(await post(editor.c, '/admin/courses', courseData(at, { translations, status: 'published', approve: true, translationStatus: 'approved' })), 400);
  }
  const draft = ok(await post(editor.c, '/admin/courses', courseData(at))).course;
  assert.equal(draft.translationStatus, 'pending'); assert.equal(draft.translationSourceFingerprint, null);
  const published = ok(await patch(editor.c, `/admin/courses/${draft.id}`, { version: draft.version, approve: true, translationStatus: 'approved', status: 'published', reason: 'Explicit review of actual translations', condition: 'open', conditionValidUntil: new Date(at + 3600000).toISOString() })).course;
  assert.match(published.sourceFingerprint, /^[a-f0-9]{64}$/); assert.equal(published.sourceFingerprint, published.translationSourceFingerprint); assert.equal(published.recommendationEligible, true);
  const changedTranslations = { ...published.translations, en: { ...published.translations.en, summary: 'Edited test translation, still not route guidance.' } };
  ok(await patch(editor.c, `/admin/courses/${draft.id}`, { version: published.version, translations: changedTranslations, approve: true, translationStatus: 'approved', reason: 'Cannot edit and approve at once' }), 409);
  const changed = ok(await patch(editor.c, `/admin/courses/${draft.id}`, { version: published.version, translations: changedTranslations, translationSourceFingerprint: published.sourceFingerprint, translationContentFingerprint: published.translationContentFingerprint, translationStatus: 'approved', reason: 'Invalidate changed translation despite injected fingerprints' })).course;
  assert.equal(changed.status, 'draft'); assert.equal(changed.translationStatus, 'pending'); assert.equal(changed.translationSourceFingerprint, null); assert.equal(changed.reviewed, false);
  assert.deepEqual(ok(await guest.call('/courses')).courses, []);
  const approvedAgain = ok(await patch(editor.c, `/admin/courses/${draft.id}`, { version: changed.version, approve: true, translationStatus: 'approved', status: 'published', reason: 'Separate translation review' })).course;
  assert.notEqual(approvedAgain.translationContentFingerprint, published.translationContentFingerprint);
  const row = h.app.db.prepare('SELECT data_json FROM courses WHERE id=?').get(draft.id); const damaged = JSON.parse(row.data_json);
  delete damaged.translations['zh-TW']; // Simulates legacy/corrupt persisted data, not a permitted API mutation.
  h.app.db.prepare('UPDATE courses SET data_json=? WHERE id=?').run(JSON.stringify(damaged), draft.id);
  const unavailable = ok(await guest.call(`/courses/${draft.id}`)).course;
  assert.equal(unavailable.translationStatus, 'pending'); assert.equal(unavailable.recommendationEligible, false);
});

test('condition review has bounded freshness and cannot predate collected evidence; expired closure remains cautious', async t => {
  const at = Date.now(); const h = await harness(t, { now: () => at }); const editor = await h.actor('freshness-editor', 'content'); const guest = h.client();
  const policy = ok(await editor.c.call('/admin/courses')).policy;
  assert.equal(policy.maxConditionValidityMs, 86400000); assert.equal(policy.separateApproverRequired, false);
  ok(await post(editor.c, '/admin/courses', courseData(at, { sourceEffectiveAt: new Date(at + 1000).toISOString() })), 400);
  ok(await post(editor.c, '/admin/courses', courseData(at, { condition: 'open', conditionValidUntil: '9999-01-01T00:00:00Z' })), 400);
  const published = ok(await post(editor.c, '/admin/courses', courseData(at, { approve: true, translationStatus: 'approved', status: 'published', condition: 'open', conditionValidUntil: new Date(at + 86400000).toISOString() }))).course;
  assert.equal(published.recommendationEligible, true);
  const row = h.app.db.prepare('SELECT data_json FROM courses WHERE id=?').get(published.id); const oldReview = JSON.parse(row.data_json);
  oldReview.reviewedAt = new Date(at - 1).toISOString();
  h.app.db.prepare('UPDATE courses SET data_json=? WHERE id=?').run(JSON.stringify(oldReview), published.id);
  const result = ok(await guest.call(`/courses/${published.id}`)).course;
  assert.equal(result.reviewed, false); assert.equal(result.recommendationEligible, false);
  const closed = ok(await post(editor.c, '/admin/courses', courseData(at, { approve: true, translationStatus: 'approved', status: 'published', condition: 'closed', conditionValidUntil: new Date(at - 1000).toISOString() }))).course;
  const cautious = ok(await guest.call(`/courses/${closed.id}`)).course;
  assert.equal(cautious.condition, 'closed'); assert.equal(cautious.recommendationEligible, false);
});

test('comments support independent report hide/restore and return the most recent 100 chronologically', async t => {
  let at = Date.now(); const h = await harness(t, { now: () => at }); const member = await h.actor('comment-member'); const admin = await h.actor('comment-admin', 'admin'); const guest = h.client();
  const p = ok(await post(member.c, '/posts', { title: 'Comment sample', body: 'Isolated test' })).post;
  const ids = [];
  for (let i = 0; i < 101; i++) { if (i > 0 && i % 25 === 0) at += 60001; ids.push(ok(await post(member.c, `/posts/${p.id}/comments`, { body: `Comment ${i}` })).comment.id); }
  const snapshot = ok(await guest.call('/posts')).posts[0];
  assert.equal(snapshot.commentSnapshotLimit, 100); assert.equal(snapshot.comments.length, 100); assert.equal(snapshot.comments[0].id, ids[1]); assert.equal(snapshot.comments.at(-1).id, ids[100]);
  const report = ok(await post(member.c, '/reports', { targetType: 'comment', targetId: ids[100], reason: 'Review this comment only' })).report;
  const listed = ok(await admin.c.call('/admin/reports')).reports[0]; assert.equal(listed.targetType, 'comment'); assert.equal(listed.targetPreview, 'Comment 100');
  ok(await post(admin.c, `/admin/reports/${report.id}/resolve`, { version: 1, action: 'hide', reason: 'Comment moderation' }));
  assert.equal(ok(await guest.call('/posts')).posts.length, 1); assert.ok(!ok(await guest.call('/posts')).posts[0].comments.some(c => c.id === ids[100]));
  ok(await post(member.c, '/reports', { targetType: 'comment', targetId: ids[100], reason: 'Hidden comments inaccessible' }), 404);
  ok(await post(admin.c, `/admin/reports/${report.id}/resolve`, { version: 1, action: 'restore', reason: 'Stale moderation' }), 409);
  ok(await post(admin.c, `/admin/reports/${report.id}/resolve`, { version: 2, action: 'restore', reason: 'Reconsidered comment' }));
  assert.equal(ok(await guest.call('/posts')).posts[0].comments.at(-1).id, ids[100]);
  assert.equal(h.app.db.prepare("SELECT count(*) n FROM audit WHERE target_id=? AND action IN ('report.hide','report.restore')").get(ids[100]).n, 2);
});

test('migration 2 preserves prior reports and makes audit and source versions append-only', async t => {
  const h = await harness(t); const admin = await h.actor('migration-admin', 'admin');
  const course = ok(await post(admin.c, '/admin/courses', courseData(Date.now()))).course;
  const p = ok(await post(admin.c, '/posts', { title: 'Prior schema post', body: 'Preserve report' })).post;
  const report = ok(await post(admin.c, '/reports', { targetType: 'post', targetId: p.id, reason: 'Prior schema report' })).report;
  await h.app.close();
  const legacy = openDatabase(h.dbPath);
  legacy.exec(`DROP TRIGGER audit_no_update; DROP TRIGGER audit_no_delete; DROP TRIGGER course_versions_no_update; DROP TRIGGER course_versions_no_delete;
    ALTER TABLE reports RENAME TO reports_new;
    CREATE TABLE reports(id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id), target_type TEXT NOT NULL CHECK(target_type IN ('message','post')), target_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    INSERT INTO reports SELECT * FROM reports_new; DROP TABLE reports_new; CREATE INDEX reports_target ON reports(target_type,target_id); DELETE FROM schema_migrations WHERE version=2;`);
  legacy.close();
  const migrated = openDatabase(h.dbPath);
  try {
    assert.equal(migrated.prepare('SELECT max(version) v FROM schema_migrations').get().v, 2);
    assert.equal(migrated.prepare('SELECT target_id FROM reports WHERE id=?').get(report.id).target_id, p.id);
    assert.equal(migrated.prepare('SELECT course_id FROM course_versions WHERE course_id=?').get(course.id).course_id, course.id);
    for (const statement of ["UPDATE audit SET reason='tamper'", 'DELETE FROM audit', "UPDATE course_versions SET reason='tamper'", 'DELETE FROM course_versions']) assert.throws(() => migrated.exec(statement), /append-only/);
  } finally { migrated.close(); }
  const reopened = createApp({ dbPath: h.dbPath });
  try { const address = await reopened.listen(0); const response = await fetch(`http://127.0.0.1:${address.port}/api/health`); assert.equal(response.status, 200); } finally { await reopened.close(); }
});

test('concurrent database openers recheck migrations after acquiring the writer transaction', async t => {
  const h = await harness(t); const freshPath = join(h.directory, 'concurrent.sqlite');
  const moduleUrl = new URL('../server/database.mjs', import.meta.url).href;
  const script = `const {openDatabase}=await import(${JSON.stringify(moduleUrl)}); const db=openDatabase(process.argv[1]); db.close();`;
  const execute = promisify(execFile);
  await Promise.all([execute(process.execPath, ['--input-type=module', '-e', script, freshPath]), execute(process.execPath, ['--input-type=module', '-e', script, freshPath])]);
  const verified = openDatabase(freshPath);
  try { assert.equal(verified.prepare('SELECT count(*) n FROM rooms').get().n, 2); assert.equal(verified.prepare('SELECT count(*) n FROM schema_migrations').get().n, 2); } finally { verified.close(); }
});

test('failed password attempts are scoped to IP and account, not a global username lock', async t => {
  const h = await harness(t); await h.actor('login-limit-user');
  async function attempt(localAddress, password) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ username: 'login-limit-user', password });
      const req = httpRequest(`${h.base}/api/auth/login`, { method: 'POST', localAddress, headers: { 'Content-Type': 'application/json', Origin: h.base } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end(payload);
    });
  }
  for (let i = 0; i < 12; i++) assert.equal(await attempt('127.0.0.1', 'wrong'), 401);
  assert.equal(await attempt('127.0.0.1', PASSWORD), 429);
  assert.equal(await attempt('127.0.0.2', PASSWORD), 200);
});
