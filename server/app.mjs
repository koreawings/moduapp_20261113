import { createServer } from 'node:http';
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addAudit } from './database.mjs';
import { openAppDatabase } from './app-database.mjs';
import { demoCourses } from './fixtures.mjs';

const scryptAsync = promisify(scrypt);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const COOKIE = 'kj_session';
const hashToken = token => createHash('sha256').update(token).digest('hex');
const CAPABILITIES = { member: [], content: ['content'], moderator: ['moderation'], admin: ['content', 'moderation', 'roles', 'audit', 'feedback'] };
const SOURCE_KEYS = ['title', 'summary', 'durationMinutes', 'difficulty', 'themes', 'startPoint', 'sourceUrl', 'sourceEffectiveAt'];
const TRANSLATION_LOCALES = ['en', 'zh-TW'];
const TRANSLATION_FIELDS = ['title', 'summary', 'startPoint'];
const REPORT_TABLES = Object.freeze({ message: 'messages', post: 'posts', comment: 'comments' });
const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEVELOPMENT_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];
const MAX_JSON_BYTES = 32768;
const sourceFingerprint = data => hashToken(JSON.stringify(SOURCE_KEYS.map(key => [key, data[key] ?? null])));
const translationFingerprint = data => hashToken(JSON.stringify([sourceFingerprint(data), TRANSLATION_LOCALES.map(locale => TRANSLATION_FIELDS.map(key => data.translations?.[locale]?.[key] ?? ''))]));
const translationsComplete = data => TRANSLATION_LOCALES.every(locale => TRANSLATION_FIELDS.every(key => typeof data.translations?.[locale]?.[key] === 'string' && data.translations[locale][key].trim()));
const translationsApproved = data => data.translationStatus === 'approved' && translationsComplete(data) && data.translationSourceFingerprint === sourceFingerprint(data) && data.translationContentFingerprint === translationFingerprint(data);

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const bad = message => fail(400, 'invalid_input', message);
function textValue(value, label, max, min = 1) {
  if (typeof value !== 'string') bad(`${label}: 문자열이 필요합니다.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) bad(`${label}: ${min}~${max}자 범위로 입력해 주세요.`);
  return normalized;
}
const boolValue = (value, label) => typeof value === 'boolean' ? value : bad(`${label}: true 또는 false가 필요합니다.`);
const versionValue = value => Number.isSafeInteger(value) && value > 0 ? value : bad('유효한 version이 필요합니다.');
const choice = (value, options, label) => options.includes(value) ? value : bad(`${label}: 허용되지 않은 값입니다.`);
function dateValue(value, label) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) bad(`${label}: ISO 날짜가 필요합니다.`);
  return new Date(value).toISOString();
}
function publicUser(row) {
  return row ? { id: row.id, username: row.username, displayName: row.display_name, role: row.role, suspended: Boolean(row.suspended), version: row.version } : null;
}
async function passwordHash(password, salt) { return Buffer.from(await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex'); }
function cookieToken(req) {
  const cookies = (req.headers.cookie ?? '').split(';');
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split('=');
    if (name === COOKIE) {
      const token = parts.join('=');
      return /^[a-f0-9]{64}$/.test(token) ? token : null;
    }
  }
  return null;
}
async function readJson(req) {
  if ((req.headers['content-type'] ?? '').toLowerCase().split(';')[0].trim() !== 'application/json') fail(415, 'json_required', 'JSON 요청이 필요합니다.');
  if (Number(req.headers['content-length'] ?? 0) > MAX_JSON_BYTES) fail(413, 'body_too_large', '요청이 너무 큽니다.');
  const chunks = []; let size = 0;
  // Keep the connection available to send a 413 after a chunked body exceeds the limit.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      req.resume();
      fail(413, 'body_too_large', '요청이 너무 큽니다.');
    }
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { bad('유효한 JSON이 필요합니다.'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') bad('JSON 객체가 필요합니다.');
  return body;
}

function parseAuthority(value, protocol) {
  if (typeof value !== 'string' || value.length > 260) return null;
  const match = /^(\[[a-f\d:.]+\]|[a-z\d.-]+)(?::(\d{1,5}))?$/i.exec(value);
  if (!match || match[0] !== value || (match[2] && Number(match[2]) === 0)) return null;
  const rawHostname = match[1].toLowerCase();
  if (!rawHostname.startsWith('[') && rawHostname.split('.').some(label => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label))) return null;
  try {
    const url = new URL(`${protocol}//${value}`);
    // URL validates bracketed IPv6. Require canonical IPv4 and DNS names.
    return rawHostname.startsWith('[') || url.hostname === rawHostname ? url : null;
  } catch { return null; }
}

function parseOrigin(value) {
  if (typeof value !== 'string') return null;
  const match = /^(https?):\/\/(.+)$/i.exec(value);
  return match?.[0] === value ? parseAuthority(match[2], `${match[1].toLowerCase()}:`)?.origin ?? null : null;
}

/** HTTP application backed by SQLite or PostgreSQL. */
export function createApp({
  dbPath = resolve(ROOT, 'data/kj-trail.sqlite'), databaseUrl, sslCaPath, database,
  distDir = resolve(ROOT, 'dist'), now = () => Date.now(), deploymentMode = 'local',
  allowedHosts = [], allowedOrigins = deploymentMode === 'local' ? DEVELOPMENT_ORIGINS : [],
  clientIp = req => req.socket?.remoteAddress ?? 'local',
  sessionTtlMs = 12 * 60 * 60 * 1000, secureCookies = deploymentMode === 'hosted',
  maxConditionValidityMs = 24 * 60 * 60 * 1000, onError = null,
} = {}) {
  // Local pilot input bound, not a claim about the freshness of real trail conditions.
  if (!Number.isSafeInteger(maxConditionValidityMs) || maxConditionValidityMs <= 0 || maxConditionValidityMs > 7 * 24 * 60 * 60 * 1000) throw new Error('Condition validity policy must be positive and at most seven days.');
  if (!['local', 'hosted'].includes(deploymentMode)) throw new Error('Unsupported deployment mode.');
  const hosted = deploymentMode === 'hosted';
  if (hosted && (!secureCookies || allowedHosts.length === 0)) throw new Error('Hosted mode requires an explicit HTTPS host allowlist and secure cookies.');
  const protocol = secureCookies ? 'https:' : 'http:';
  const knownHosts = new Set(allowedHosts.map(value => {
    const url = parseAuthority(value, protocol);
    if (!url) throw new Error('Allowed hosts must be exact hostnames with an optional port.');
    return url.host;
  }));
  const knownOrigins = new Set(allowedOrigins.map(value => {
    const origin = parseOrigin(value);
    if (!origin || (hosted && !origin.startsWith('https://'))) throw new Error('Invalid allowed origin.');
    return origin;
  }));
  const db = database ?? openAppDatabase({ dbPath, databaseUrl, sslCaPath });
  const usernameKey = db.dialect === 'postgresql' ? 'lower(username)' : 'username';
  const time = () => Number(now());
  const iso = () => new Date(time()).toISOString();
  const limitBuckets = new Map();
  let closed = false;

  function rate(key, max, windowMs) {
    const current = time(); const previous = limitBuckets.get(key);
    if (!previous || current >= previous.until) {
      if (limitBuckets.size > 5000) { for (const [k, v] of limitBuckets) if (current >= v.until) limitBuckets.delete(k); }
      if (limitBuckets.size > 10000) fail(429, 'rate_limited', '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      limitBuckets.set(key, { count: 1, until: current + windowMs }); return;
    }
    previous.count += 1;
    if (previous.count > max) fail(429, 'rate_limited', '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  async function auth(req, required = false) {
    const token = cookieToken(req);
    const row = token ? await db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hashToken(token), time()) : null;
    if (required && !row) fail(401, 'login_required', '로그인이 필요합니다.');
    if (required && row.suspended) fail(403, 'account_suspended', '이 계정은 이용이 제한되었습니다.');
    return row;
  }
  async function requireCapability(req, capability) {
    const user = await auth(req, true);
    if (!CAPABILITIES[user.role]?.includes(capability)) fail(403, 'forbidden', '이 작업의 권한이 없습니다.');
    return user;
  }
  async function requireRoom(id) {
    const room = await db.prepare('SELECT * FROM rooms WHERE id=?').get(id);
    if (!room) fail(404, 'not_found', '대화방을 찾을 수 없습니다.');
    return room;
  }
  async function membership(userId, roomId) {
    const member = await db.prepare('SELECT * FROM memberships WHERE room_id=? AND user_id=? AND active=1').get(roomId, userId);
    if (!member) fail(403, 'membership_required', '현재 참여 중인 방만 이용할 수 있습니다.');
    return member;
  }
  function sessionCookie(token, maxAge = Math.floor(sessionTtlMs / 1000)) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
  }
  async function newSession(req, userId) {
    const token = randomBytes(32).toString('hex');
    const old = cookieToken(req);
    if (old) await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(old));
    await db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(time());
    await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hashToken(token), userId, time() + sessionTtlMs, iso());
    return token;
  }
  function courseOutput(row, privateView = false) {
    const data = JSON.parse(row.data_json);
    const fetched = Date.parse(data.fetchedAt ?? ''); const reviewed = Date.parse(data.reviewedAt ?? '');
    const reviewValid = Number.isFinite(fetched) && fetched <= time() && Number.isFinite(reviewed) && reviewed <= time() && reviewed >= fetched && Boolean(data.sourceUrl && data.reviewer);
    const validUntil = Date.parse(data.conditionValidUntil ?? '');
    const openCurrent = data.condition === 'open' && validUntil > time() && validUntil <= reviewed + maxConditionValidityMs;
    const translationValid = translationsApproved(data);
    return { ...data, id: row.id, status: row.status, version: row.version, isFixture: false,
      reviewer: privateView ? data.reviewer : null, reviewed: reviewValid,
      condition: !privateView && data.condition === 'open' && !openCurrent ? 'unknown' : data.condition,
      lastKnownCondition: data.condition === 'open' && !openCurrent ? 'open' : null,
      sourceFingerprint: sourceFingerprint(data), translationStatus: translationValid ? 'approved' : 'pending',
      recommendationEligible: row.status === 'published' && openCurrent && reviewValid && translationValid };
  }
  function messageOutput(row) {
    return { id: row.id, roomId: row.room_id, authorId: row.author_id, authorName: row.author_name ?? row.display_name, body: row.body, createdAt: row.created_at, clientMessageId: row.client_message_id };
  }
  function postOutput(row, comments = []) {
    return { id: row.id, title: row.title, body: row.body, authorId: row.author_id, authorName: row.author_name, createdAt: row.created_at, version: row.version,
      commentSnapshotLimit: 100, comments: comments.map(c => ({ id: c.id, authorId: c.author_id, authorName: c.author_name, body: c.body, createdAt: c.created_at })) };
  }
  function sourceUrl(value) {
    const raw = textValue(value ?? '', '출처 URL', 2048, 0); if (!raw) return '';
    let url; try { url = new URL(raw); } catch { bad('올바른 출처 URL을 입력해 주세요.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) bad('http(s) 출처 URL만 허용됩니다.');
    return url.href;
  }
  function validateCourse(body, oldData = null, user) {
    if (body.isFixture === true || (typeof body.id === 'string' && body.id.startsWith('demo-'))) bad('가상 예시를 운영 콘텐츠로 게시할 수 없습니다.');
    const base = { title: '', summary: '', durationMinutes: 0, difficulty: 'easy', themes: [], startPoint: '', sourceUrl: '', sourceEffectiveAt: null, fetchedAt: null, reviewedAt: null, reviewer: null, status: 'draft', condition: 'unknown', conditionValidUntil: null, translationStatus: 'pending', translations: {}, translationSourceFingerprint: null, translationContentFingerprint: null, ...oldData };
    const merged = { ...base };
    for (const key of ['title', 'summary', 'durationMinutes', 'difficulty', 'themes', 'startPoint', 'sourceUrl', 'sourceEffectiveAt', 'fetchedAt', 'status', 'condition', 'conditionValidUntil', 'translationStatus', 'translations']) if (Object.hasOwn(body, key)) merged[key] = body[key];
    merged.title = textValue(merged.title, '코스명', 120);
    merged.summary = textValue(merged.summary, '설명', 8000);
    merged.startPoint = textValue(merged.startPoint, '출발지', 200, 0);
    if (!Number.isSafeInteger(merged.durationMinutes) || merged.durationMinutes < 0 || merged.durationMinutes > 1440) bad('시간은 0~1440 사이 정수여야 합니다.');
    merged.difficulty = choice(merged.difficulty, ['easy', 'moderate', 'hard'], '난이도');
    if (!Array.isArray(merged.themes) || merged.themes.length > 12) bad('테마는 12개 이하 배열이어야 합니다.');
    merged.themes = [...new Set(merged.themes.map(t => textValue(t, '테마', 40)))];
    merged.sourceUrl = sourceUrl(merged.sourceUrl);
    merged.sourceEffectiveAt = dateValue(merged.sourceEffectiveAt, '출처 기준일');
    if (merged.sourceEffectiveAt && Date.parse(merged.sourceEffectiveAt) > time()) bad('출처 기준일은 미래가 될 수 없습니다.');
    merged.fetchedAt = dateValue(merged.fetchedAt, '수집 시각');
    if (merged.fetchedAt && Date.parse(merged.fetchedAt) > time()) bad('수집 시각은 미래가 될 수 없습니다.');
    merged.conditionValidUntil = dateValue(merged.conditionValidUntil, '상태 유효기한');
    merged.status = choice(merged.status, ['draft', 'published', 'withdrawn'], '게시 상태');
    merged.condition = choice(merged.condition, ['unknown', 'open', 'closed'], '현재 상태');
    merged.translationStatus = choice(merged.translationStatus, ['pending', 'approved'], '번역 상태');
    if (!merged.translations || typeof merged.translations !== 'object' || Array.isArray(merged.translations)) bad('번역은 언어별 객체가 필요합니다.');
    const translations = {};
    for (const locale of TRANSLATION_LOCALES) {
      const value = merged.translations[locale] ?? {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) bad(`${locale}: 번역 객체가 필요합니다.`);
      translations[locale] = Object.fromEntries(TRANSLATION_FIELDS.map(key => [key, textValue(value[key] ?? '', `${locale} ${key}`, key === 'summary' ? 8000 : key === 'title' ? 120 : 200, 0)]));
    }
    merged.translations = translations;
    const changed = oldData && SOURCE_KEYS.some(k => JSON.stringify(base[k]) !== JSON.stringify(merged[k]));
    const translationChanged = oldData && translationFingerprint(base) !== translationFingerprint(merged);
    const evidenceChanged = oldData && ['fetchedAt', 'condition', 'conditionValidUntil'].some(k => base[k] !== merged[k]);
    if ((changed || translationChanged) && body.approve === true) fail(409, 'content_changed_review_required', '원문 또는 번역이 변경되었습니다. 먼저 초안을 저장하고 번역을 다시 검토한 후 별도로 승인해 주세요.');
    if ((changed || translationChanged) && body.approve !== true) { merged.status = 'draft'; merged.translationStatus = 'pending'; merged.translationSourceFingerprint = null; merged.translationContentFingerprint = null; merged.reviewedAt = null; merged.reviewer = null; }
    if (evidenceChanged && body.approve !== true) { merged.status = merged.status === 'withdrawn' ? 'withdrawn' : 'draft'; merged.reviewedAt = null; merged.reviewer = null; }
    if (merged.condition === 'open' && Date.parse(merged.conditionValidUntil ?? '') > time() + maxConditionValidityMs) bad('개방 상태 유효기한이 로컬 검수 정책 상한을 초과합니다.');
    if (body.approve === true) {
      if (!merged.sourceUrl || !merged.fetchedAt || !merged.startPoint || merged.durationMinutes <= 0 || body.translationStatus !== 'approved' || !translationsComplete(merged)) bad('승인에는 출처·수집 시각·출발지·소요시간과 영어·번체 중국어의 코스명·설명·출발지 번역 검수가 필요합니다.');
      if (merged.condition === 'open' && !(Date.parse(merged.conditionValidUntil ?? '') > time())) bad('개방 상태는 미래의 유효기한이 필요합니다.');
      merged.reviewedAt = iso(); merged.reviewer = user.username;
      merged.translationSourceFingerprint = sourceFingerprint(merged); merged.translationContentFingerprint = translationFingerprint(merged);
    } else if (!translationsApproved(merged)) {
      merged.translationStatus = 'pending'; merged.translationSourceFingerprint = null; merged.translationContentFingerprint = null;
    }
    if (merged.status === 'published' && (!merged.reviewedAt || !merged.reviewer || !merged.sourceUrl || !merged.fetchedAt || Date.parse(merged.reviewedAt) < Date.parse(merged.fetchedAt) || !translationsApproved(merged))) fail(400, 'approval_required', '검토 승인 후 게시할 수 있습니다.');
    for (const key of ['id', 'version', 'isFixture', 'recommendationEligible', 'reviewed', 'lastKnownCondition', 'sourceFingerprint']) delete merged[key];
    return merged;
  }
  function audit(user, action, targetId, reason, details = {}) { return addAudit(db, { actorId: user.id, action, targetId, reason, details, at: iso() }); }
  function checkVersion(row, value) { if (row.version !== versionValue(value)) fail(409, 'version_conflict', '다른 변경이 있습니다. 새로고침 후 다시 확인해 주세요.'); }

  async function prepareCredentials(req, path, body) {
    if (req.method !== 'POST' || (path !== '/auth/register' && path !== '/auth/login')) return;
    const ip = clientIp(req);
    if (path === '/auth/register') {
      rate(`register:${ip}`, 10, 60 * 60 * 1000);
      const username = textValue(body.username, '사용자명', 32, 3).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) bad('사용자명은 영문 소문자·숫자·밑줄·점·하이픈 3~32자로 입력해 주세요.');
      const displayName = textValue(body.displayName, '표시 이름', 50);
      if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 256) bad('비밀번호는 12~256자여야 합니다.');
      const salt = randomBytes(16).toString('hex');
      return { username, displayName, salt, hashed: await passwordHash(body.password, salt) };
    }

    rate(`login:${ip}`, 25, 15 * 60 * 1000);
    const username = textValue(body.username, '사용자명', 32, 3).toLowerCase();
    if (typeof body.password !== 'string' || body.password.length > 256) bad('비밀번호를 입력해 주세요.');
    rate(`login-user:${ip}:${hashToken(username)}`, 12, 15 * 60 * 1000);
    const user = await db.request({ write: false }, () => db.prepare(`SELECT * FROM users WHERE ${usernameKey}=?`).get(username));
    // Derive the password outside the write lock, including for a missing account.
    const derived = Buffer.from(await passwordHash(body.password, user?.password_salt ?? 'not-a-real-account-salt'), 'hex');
    const expected = Buffer.from(user?.password_hash ?? '0'.repeat(128), 'hex');
    if (derived.length !== expected.length || !timingSafeEqual(derived, expected) || !user) fail(401, 'invalid_credentials', '사용자명 또는 비밀번호가 올바르지 않습니다.');
    return user;
  }

  async function api(req, path, url, body, credentials, response) {
    const method = req.method;
    const segments = path.split('/').filter(Boolean);
    if (method === 'GET' && path === '/health') return { ok: true, mode: deploymentMode, contentMode: 'unverified', storage: db.dialect, transport: 'authorized-polling', retentionConfigured: false };
    if (method === 'GET' && path === '/session') return { user: publicUser(await auth(req)) };
    if (method === 'POST' && path === '/auth/register') {
      const { username, displayName, salt, hashed } = credentials;
      if (await db.prepare(`SELECT id FROM users WHERE ${usernameKey}=?`).get(username)) fail(409, 'username_taken', '이미 사용 중인 사용자명입니다.');
      const id = randomUUID();
      try { await db.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?)').run(id, username, displayName, hashed, salt, iso()); }
      catch (error) { if (error.code === '23505' || /UNIQUE constraint/.test(error.message)) fail(409, 'username_taken', '이미 사용 중인 사용자명입니다.'); throw error; }
      response.cookie = sessionCookie(await newSession(req, id));
      return { user: publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(id)) };
    }
    if (method === 'POST' && path === '/auth/login') {
      const user = await db.prepare('SELECT * FROM users WHERE id=?').get(credentials.id);
      if (!user || user.password_hash !== credentials.password_hash || user.password_salt !== credentials.password_salt) fail(401, 'invalid_credentials', '사용자명 또는 비밀번호가 올바르지 않습니다.');
      if (user.suspended) fail(403, 'account_suspended', '이 계정은 이용이 제한되었습니다.');
      response.cookie = sessionCookie(await newSession(req, user.id));
      return { user: publicUser(user) };
    }
    if (method === 'POST' && path === '/auth/logout') {
      const token = cookieToken(req);
      if (token) await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
      response.cookie = sessionCookie('', 0);
      return { ok: true };
    }
    if (method === 'GET' && path === '/courses') {
      if (url.searchParams.get('demo') === '1') return { courses: demoCourses, fixture: true };
      const courses = await db.prepare("SELECT * FROM courses WHERE status='published' ORDER BY updated_at DESC LIMIT 200").all();
      return { courses: courses.map(row => courseOutput(row)), fixture: false };
    }
    if (method === 'GET' && segments[0] === 'courses' && segments.length === 2) {
      if (url.searchParams.get('demo') === '1') { const course = demoCourses.find(c => c.id === segments[1]); if (course) return { course, fixture: true }; }
      const course = await db.prepare("SELECT * FROM courses WHERE id=? AND status='published'").get(segments[1]);
      if (!course) fail(404, 'not_found', '공개 코스를 찾을 수 없습니다.'); return { course: courseOutput(course) };
    }
    if (method === 'GET' && path === '/rooms') {
      const user = await auth(req);
      const rows = await db.prepare('SELECT r.*,m.active AS joined FROM rooms r LEFT JOIN memberships m ON m.room_id=r.id AND m.user_id=? ORDER BY r.rowid').all(user && !user.suspended ? user.id : '');
      return { rooms: rows.map(r => ({ id: r.id, name: r.name, description: r.description, locked: Boolean(r.locked), joined: Boolean(r.joined), version: r.version })) };
    }
    if (segments[0] === 'rooms' && segments.length === 3) {
      const user = await auth(req, true); const room = await requireRoom(segments[1]); const operation = segments[2];
      if (method === 'POST' && operation === 'join') {
        if (room.locked) fail(423, 'room_locked', '잠긴 방에는 새로 참여할 수 없습니다.');
        const old = await db.prepare('SELECT active FROM memberships WHERE room_id=? AND user_id=?').get(room.id, user.id);
        if (!old?.active) {
          const after = await db.prepare('SELECT coalesce(max(seq),0) AS value FROM messages WHERE room_id=?').get(room.id);
          await db.prepare('INSERT INTO memberships(room_id,user_id,joined_at,joined_after_seq,active) VALUES(?,?,?,?,1) ON CONFLICT(room_id,user_id) DO UPDATE SET joined_at=excluded.joined_at,joined_after_seq=excluded.joined_after_seq,active=1').run(room.id, user.id, iso(), after.value);
        }
        return { ok: true };
      }
      if (method === 'DELETE' && operation === 'membership') {
        await db.prepare('UPDATE memberships SET active=0 WHERE room_id=? AND user_id=?').run(room.id, user.id);
        return { ok: true };
      }
      if (operation === 'messages') {
        const member = await membership(user.id, room.id);
        if (method === 'GET') {
          const messages = await db.prepare(`SELECT m.*,u.display_name AS author_name FROM messages m JOIN users u ON u.id=m.author_id WHERE m.room_id=? AND m.seq>? AND m.hidden=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.blocked_id=m.author_id) ORDER BY m.seq DESC LIMIT 200`).all(room.id, member.joined_after_seq, user.id);
          return { messages: messages.reverse().map(messageOutput), snapshotLimit: 200, historyPolicy: 'since-current-room-join' };
        }
        if (method === 'POST') {
          const messageBody = textValue(body.body, '메시지', 2000); const key = textValue(body.clientMessageId, '전송 식별자', 100, 8);
          if (!/^[a-zA-Z0-9_.:-]+$/.test(key)) bad('전송 식별자 형식이 올바르지 않습니다.');
          const existing = await db.prepare('SELECT m.*,u.display_name AS author_name FROM messages m JOIN users u ON u.id=m.author_id WHERE m.author_id=? AND m.client_message_id=?').get(user.id, key);
          if (existing) {
            if (existing.room_id !== room.id || existing.body !== messageBody) fail(409, 'idempotency_conflict', '같은 전송 식별자에 다른 내용을 사용할 수 없습니다.');
            if (existing.seq <= member.joined_after_seq || existing.hidden) fail(409, 'message_unavailable', '이 메시지는 현재 이력 범위에서 다시 가져올 수 없습니다.');
            return { message: messageOutput(existing), duplicate: true };
          }
          if (room.locked) fail(423, 'room_locked', '운영자가 이 방의 전송을 잠갔습니다.');
          rate(`message:${user.id}`, 30, 10000);
          const id = randomUUID();
          await db.prepare('INSERT INTO messages(id,room_id,author_id,body,client_message_id,created_at) VALUES(?,?,?,?,?,?)').run(id, room.id, user.id, messageBody, key, iso());
          const message = await db.prepare('SELECT m.*,u.display_name AS author_name FROM messages m JOIN users u ON u.id=m.author_id WHERE m.id=?').get(id);
          return { message: messageOutput(message) };
        }
      }
    }
    if (path === '/blocks' && method === 'GET') {
      const user = await auth(req, true);
      return { blocks: await db.prepare('SELECT u.id AS "userId",u.display_name AS "displayName" FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=? ORDER BY b.created_at DESC LIMIT 1000').all(user.id) };
    }
    if (path === '/blocks' && method === 'POST') {
      const user = await auth(req, true); const targetId = textValue(body.userId, '대상', 80);
      if (targetId === user.id) bad('자신을 차단할 수 없습니다.');
      if (!(await db.prepare('SELECT id FROM users WHERE id=?').get(targetId))) fail(404, 'not_found', '대상을 찾을 수 없습니다.');
      await db.prepare('INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?) ON CONFLICT(blocker_id,blocked_id) DO NOTHING').run(user.id, targetId, iso());
      return { ok: true };
    }
    if (segments[0] === 'blocks' && segments.length === 2 && method === 'DELETE') {
      const user = await auth(req, true);
      await db.prepare('DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?').run(user.id, segments[1]);
      return { ok: true };
    }
    if (path === '/posts' && method === 'GET') {
      const user = await auth(req);
      const rows = await db.prepare(`SELECT p.*,u.display_name AS author_name FROM posts p JOIN users u ON u.id=p.author_id WHERE p.hidden=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.blocked_id=p.author_id) ORDER BY p.created_at DESC,p.id DESC LIMIT 50`).all(user?.id ?? '');
      if (rows.length === 0) return { posts: [] };
      const comments = await db.prepare(`
        WITH ranked_comments AS (
          SELECT c.id,c.post_id,c.author_id,c.body,c.created_at,
                 row_number() OVER (PARTITION BY c.post_id ORDER BY c.created_at DESC,c.rowid DESC) AS position
          FROM comments c
          WHERE c.post_id IN (${rows.map(() => '?').join(',')})
            AND c.hidden=0
            AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=? AND b.blocked_id=c.author_id)
        )
        SELECT c.*,u.display_name AS author_name
        FROM ranked_comments c JOIN users u ON u.id=c.author_id
        WHERE c.position<=100
        ORDER BY c.post_id,c.position DESC
      `).all(...rows.map(row => row.id), user?.id ?? '');
      const commentsByPost = Map.groupBy(comments, comment => comment.post_id);
      return { posts: rows.map(row => postOutput(row, commentsByPost.get(row.id))) };
    }
    if (path === '/posts' && method === 'POST') {
      const user = await auth(req, true); rate(`post:${user.id}`, 10, 60000);
      const title = textValue(body.title, '제목', 120); const content = textValue(body.body, '본문', 8000); const id = randomUUID();
      await db.prepare('INSERT INTO posts(id,author_id,title,body,created_at) VALUES(?,?,?,?,?)').run(id, user.id, title, content, iso());
      const post = await db.prepare('SELECT p.*,u.display_name AS author_name FROM posts p JOIN users u ON u.id=p.author_id WHERE p.id=?').get(id);
      return { post: postOutput(post) };
    }
    if (segments[0] === 'posts' && segments.length === 3 && segments[2] === 'comments' && method === 'POST') {
      const user = await auth(req, true); rate(`comment:${user.id}`, 30, 60000);
      const post = await db.prepare('SELECT * FROM posts WHERE id=? AND hidden=0').get(segments[1]); if (!post) fail(404, 'not_found', '게시글을 찾을 수 없습니다.');
      if (await db.prepare('SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?').get(user.id, post.author_id)) fail(403, 'blocked_author', '차단한 작성자의 게시글입니다.');
      const content = textValue(body.body, '댓글', 2000); const id = randomUUID(); const at = iso();
      await db.prepare('INSERT INTO comments(id,post_id,author_id,body,created_at) VALUES(?,?,?,?,?)').run(id, post.id, user.id, content, at);
      return { comment: { id, authorId: user.id, authorName: user.display_name, body: content, createdAt: at } };
    }
    if (path === '/reports' && method === 'POST') {
      const user = await auth(req, true); rate(`report:${user.id}`, 15, 60000);
      const type = choice(body.targetType, ['message', 'post', 'comment'], '신고 대상 종류'); const targetId = textValue(body.targetId, '대상', 80); const reason = textValue(body.reason, '신고 사유', 1000);
      if (type === 'message') {
        const target = await db.prepare('SELECT * FROM messages WHERE id=? AND hidden=0').get(targetId); if (!target) fail(404, 'not_found', '신고 대상을 찾을 수 없습니다.');
        const member = await membership(user.id, target.room_id); if (target.seq <= member.joined_after_seq) fail(404, 'not_found', '접근 가능한 신고 대상을 찾을 수 없습니다.');
      } else if (type === 'comment') {
        if (!(await db.prepare('SELECT c.id FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=? AND c.hidden=0 AND p.hidden=0').get(targetId))) fail(404, 'not_found', '신고 대상을 찾을 수 없습니다.');
      } else if (!(await db.prepare('SELECT id FROM posts WHERE id=? AND hidden=0').get(targetId))) fail(404, 'not_found', '신고 대상을 찾을 수 없습니다.');
      const old = await db.prepare("SELECT id FROM reports WHERE reporter_id=? AND target_type=? AND target_id=? AND status='open'").get(user.id, type, targetId);
      if (old) return { report: { id: old.id, status: 'open' } };
      const id = randomUUID(); const at = iso();
      await db.prepare('INSERT INTO reports(id,reporter_id,target_type,target_id,reason,created_at) VALUES(?,?,?,?,?,?)').run(id, user.id, type, targetId, reason, at);
      return { report: { id, status: 'open', createdAt: at } };
    }
    if (path === '/feedback' && method === 'POST') {
      const user = await auth(req, true); rate(`feedback:${user.id}`, 10, 60000);
      await db.prepare('INSERT INTO feedback(id,author_id,category,body,created_at) VALUES(?,?,?,?,?)').run(randomUUID(), user.id, textValue(body.category, '분류', 60), textValue(body.body, '의견', 4000), iso());
      return { ok: true };
    }
    if (segments[0] === 'admin') {
      if (path === '/admin/overview' && method === 'GET') {
        const user = await auth(req, true); const capabilities = CAPABILITIES[user.role]; if (!capabilities?.length) fail(403, 'forbidden', '운영 권한이 필요합니다.');
        const count = async name => (await db.prepare(`SELECT count(*) AS count FROM ${name}`).get()).count;
        const canModerate = capabilities.includes('moderation');
        const openReports = canModerate ? await db.prepare("SELECT count(*) AS count FROM reports WHERE status='open'").get() : null;
        // Counts are only returned for the corresponding management capability.
        return { counts: { users: canModerate ? await count('users') : null, courses: capabilities.includes('content') ? await count('courses') : null, reports: canModerate ? await count('reports') : null, openReports: openReports?.count ?? null, messages: canModerate ? await count('messages') : null }, capabilities, contentMode: 'unverified', mode: deploymentMode, retentionConfigured: false, measuredAt: iso() };
      }
      if (path === '/admin/courses') {
        const user = await requireCapability(req, 'content');
        if (method === 'GET') {
          const rows = await db.prepare('SELECT * FROM courses ORDER BY updated_at DESC LIMIT 500').all();
          return { courses: rows.map(row => courseOutput(row, true)), policy: { maxConditionValidityMs, requiredTranslationLocales: TRANSLATION_LOCALES, separateApproverRequired: false, approvalMode: 'local-single-operator' } };
        }
        if (method === 'POST') {
          const reason = textValue(body.reason, '변경 사유', 1000); const data = validateCourse(body, null, user); const id = randomUUID();
          await db.prepare('INSERT INTO courses(id,data_json,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, JSON.stringify(data), data.status, iso(), iso());
          await db.prepare('INSERT INTO course_versions(id,course_id,version,data_json,actor_id,reason,created_at) VALUES(?,?,1,?,?,?,?)').run(randomUUID(), id, JSON.stringify(data), user.id, reason, iso());
          await audit(user, data.status === 'published' ? 'course.create-published' : 'course.create', id, reason, { version: 1, status: data.status, approved: body.approve === true, approvalPolicy: 'local-single-operator', selfReviewAllowed: true });
          return { course: courseOutput(await db.prepare('SELECT * FROM courses WHERE id=?').get(id), true) };
        }
      }
      if (segments[1] === 'courses' && segments.length === 3 && method === 'PATCH') {
        const user = await requireCapability(req, 'content'); const reason = textValue(body.reason, '변경 사유', 1000);
        const row = await db.prepare('SELECT * FROM courses WHERE id=?').get(segments[2]); if (!row) fail(404, 'not_found', '코스를 찾을 수 없습니다.'); checkVersion(row, body.version);
        const data = validateCourse(body, JSON.parse(row.data_json), user); const next = row.version + 1;
        await db.prepare('UPDATE courses SET data_json=?,status=?,version=?,updated_at=? WHERE id=?').run(JSON.stringify(data), data.status, next, iso(), row.id);
        await db.prepare('INSERT INTO course_versions(id,course_id,version,data_json,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), row.id, next, JSON.stringify(data), user.id, reason, iso());
        await audit(user, 'course.update', row.id, reason, { previousVersion: row.version, version: next, previousStatus: row.status, status: data.status, approved: body.approve === true, approvalPolicy: 'local-single-operator', selfReviewAllowed: true });
        return { course: courseOutput(await db.prepare('SELECT * FROM courses WHERE id=?').get(row.id), true) };
      }
      if (path === '/admin/reports' && method === 'GET') {
        await requireCapability(req, 'moderation');
        const rows = await db.prepare(`
          WITH recent_reports AS (SELECT * FROM reports ORDER BY created_at DESC,id DESC LIMIT 200)
          SELECT r.*,coalesce(m.body,p.body,c.body) AS target_body,
                 coalesce(m.hidden,p.hidden,c.hidden) AS target_hidden,u.display_name AS author_name
          FROM recent_reports r
          LEFT JOIN messages m ON r.target_type='message' AND m.id=r.target_id
          LEFT JOIN posts p ON r.target_type='post' AND p.id=r.target_id
          LEFT JOIN comments c ON r.target_type='comment' AND c.id=r.target_id
          LEFT JOIN users u ON u.id=coalesce(m.author_id,p.author_id,c.author_id)
          ORDER BY r.created_at DESC,r.id DESC
        `).all();
        return { reports: rows.map(r => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, status: r.status, version: r.version, createdAt: r.created_at, targetPreview: r.target_body?.slice(0, 2000) ?? null, authorName: r.author_name, targetHidden: Boolean(r.target_hidden) })) };
      }
      if (segments[1] === 'reports' && segments.length === 4 && segments[3] === 'resolve' && method === 'POST') {
        const user = await requireCapability(req, 'moderation'); const action = choice(body.action, ['hide', 'restore', 'dismiss'], '조치'); const reason = textValue(body.reason, '조치 사유', 1000);
        const report = await db.prepare('SELECT * FROM reports WHERE id=?').get(segments[2]); if (!report) fail(404, 'not_found', '신고를 찾을 수 없습니다.'); checkVersion(report, body.version);
        const table = REPORT_TABLES[report.target_type];
        const target = await db.prepare(`SELECT hidden FROM ${table} WHERE id=?`).get(report.target_id); if (!target) fail(404, 'not_found', '신고 대상을 찾을 수 없습니다.');
        if (action !== 'dismiss') {
          await db.prepare(`UPDATE ${table} SET hidden=?${table === 'posts' ? ',version=version+1' : ''} WHERE id=?`).run(action === 'hide' ? 1 : 0, report.target_id);
          // A target change also invalidates stale review screens for other reports on it.
          await db.prepare('UPDATE reports SET version=version+1 WHERE target_type=? AND target_id=? AND id<>?').run(report.target_type, report.target_id, report.id);
        }
        await db.prepare("UPDATE reports SET status='resolved',version=version+1 WHERE id=?").run(report.id);
        await audit(user, `report.${action}`, report.target_id, reason, { reportId: report.id, targetType: report.target_type, previousHidden: Boolean(target.hidden), hidden: action === 'dismiss' ? Boolean(target.hidden) : action === 'hide' });
        return { ok: true };
      }
      if (path === '/admin/users' && method === 'GET') {
        await requireCapability(req, 'moderation');
        const rows = await db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 500').all();
        return { users: rows.map(publicUser) };
      }
      if (segments[1] === 'users' && segments.length === 3 && method === 'PATCH') {
        const user = await requireCapability(req, 'moderation'); const suspended = boolValue(body.suspended, '제재 상태'); const reason = textValue(body.reason, '조치 사유', 1000);
        const target = await db.prepare('SELECT * FROM users WHERE id=?').get(segments[2]); if (!target) fail(404, 'not_found', '회원을 찾을 수 없습니다.');
        if (target.id === user.id || target.role === 'admin') fail(403, 'protected_account', '자신 또는 최고 관리자 계정을 이 경로로 제재할 수 없습니다.');
        checkVersion(target, body.version);
        await db.prepare('UPDATE users SET suspended=?,version=version+1 WHERE id=?').run(suspended ? 1 : 0, target.id);
        // Sessions are revoked so un-suspending does not resurrect old sessions.
        if (suspended) await db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
        await audit(user, suspended ? 'user.suspend' : 'user.restore', target.id, reason, { previousSuspended: Boolean(target.suspended), suspended });
        return { user: publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(target.id)) };
      }
      if (segments[1] === 'rooms' && segments.length === 4 && segments[3] === 'lock' && method === 'POST') {
        const user = await requireCapability(req, 'moderation'); const locked = boolValue(body.locked, '방 잠금'); const reason = textValue(body.reason, '조치 사유', 1000);
        const room = await requireRoom(segments[2]); checkVersion(room, body.version);
        await db.prepare('UPDATE rooms SET locked=?,version=version+1 WHERE id=?').run(locked ? 1 : 0, room.id);
        await audit(user, locked ? 'room.lock' : 'room.unlock', room.id, reason, { previousLocked: Boolean(room.locked), locked });
        return { ok: true };
      }
      if (path === '/admin/audit' && method === 'GET') {
        await requireCapability(req, 'audit');
        return { entries: await db.prepare('SELECT id,actor_id AS "actorId",action,target_id AS "targetId",reason,details_json AS "detailsJson",created_at AS "createdAt" FROM audit ORDER BY rowid DESC LIMIT 300').all() };
      }
      if (path === '/admin/feedback' && method === 'GET') {
        await requireCapability(req, 'feedback');
        return { feedback: await db.prepare('SELECT id,author_id AS "authorId",category,body,created_at AS "createdAt" FROM feedback ORDER BY created_at DESC LIMIT 200').all() };
      }
    }
    fail(404, 'not_found', '요청한 기능을 찾을 수 없습니다.');
  }

  function verifyRequest(req) {
    const host = parseAuthority(req.headers.host, protocol);
    if (!host) fail(400, 'invalid_host', '올바른 호스트가 필요합니다.');
    const allowed = knownHosts.has(host.host) || (!hosted && LOOPBACK_HOSTS.has(host.hostname));
    if (!allowed) fail(403, 'invalid_host', '허용된 호스트가 아닙니다.');
    if (WRITE_METHODS.has(req.method)) {
      const originHeader = req.headers.origin;
      if (originHeader !== undefined) {
        const origin = parseOrigin(originHeader);
        if (origin !== host.origin && (hosted || !knownOrigins.has(origin))) fail(403, 'origin_rejected', '다른 출처의 변경 요청은 허용되지 않습니다.');
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'origin_rejected', '다른 사이트의 변경 요청은 허용되지 않습니다.');
    }
    return host.origin;
  }
  function sendJson(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value));
  }
  async function staticFile(req, res, pathname) {
    if (!['GET', 'HEAD'].includes(req.method)) fail(404, 'not_found', '요청한 페이지를 찾을 수 없습니다.');
    const base = resolve(distDir); const candidate = resolve(base, `.${pathname}`);
    if (candidate !== base && !candidate.startsWith(base + sep)) fail(404, 'not_found', '요청한 페이지를 찾을 수 없습니다.');
    let target = candidate;
    try { if (!(await stat(target)).isFile()) target = resolve(base, 'index.html'); }
    catch { if (extname(pathname)) fail(404, 'not_found', '파일을 찾을 수 없습니다.'); target = resolve(base, 'index.html'); }
    let content; try { content = await readFile(target); } catch { fail(404, 'client_not_built', '클라이언트 빌드가 없습니다. 개발 화면 또는 npm run build를 사용하세요.'); }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
    res.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': extname(target) === '.html' ? 'no-store' : 'public,max-age=3600', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    res.end(req.method === 'HEAD' ? undefined : content);
  }
  async function handleRequest(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
    try {
      const origin = verifyRequest(req);
      let url; try { url = new URL(req.url, origin); } catch { bad('URL 형식이 올바르지 않습니다.'); }
      if (url.origin !== origin) bad('URL 형식이 올바르지 않습니다.');
      let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { bad('URL 형식이 올바르지 않습니다.'); }
      if (pathname.includes('\0') || pathname.includes('\\')) bad('URL 형식이 올바르지 않습니다.');
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        const write = WRITE_METHODS.has(req.method);
        const body = write ? await readJson(req) : {};
        const path = pathname.slice(4).replace(/\/$/, '') || '/';
        const credentials = await prepareCredentials(req, path, body);
        const response = {};
        // Keep authorization, application updates and their audit records in the same database request.
        const payload = await db.request({ write }, () => api(req, path, url, body, credentials, response));
        if (response.cookie) res.setHeader('Set-Cookie', response.cookie);
        sendJson(res, 200, payload);
      } else await staticFile(req, res, pathname);
    } catch (error) {
      if (!(error instanceof ApiError)) onError?.(error);
      if (!res.headersSent) sendJson(res, error instanceof ApiError ? error.status : 500, { error: error instanceof ApiError ? error.message : '서버 처리에 실패했습니다. 다시 시도해 주세요.', code: error instanceof ApiError ? error.code : 'internal_error' });
      else res.end();
    }
  }
  const server = createServer(handleRequest);
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return { db: db.raw ?? db, server, handleRequest,
    async listen(port = 8787, host = '127.0.0.1') {
      await db.ready();
      return new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolveListen(server.address()); }); });
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        if (server.listening) {
          const stopped = new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
          server.closeAllConnections();
          await stopped;
        }
      } finally {
        await db.close();
      }
    },
  };
}
