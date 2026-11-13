import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

function enableWal(db) {
  // journal_mode changes can return SQLITE_BUSY without invoking busy_timeout.
  // Retry only this startup transition; do not replay partially applied migrations.
  const deadline = performance.now() + 5000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    try {
      const current = db.prepare('PRAGMA journal_mode').get().journal_mode;
      if (current !== 'wal' && current !== 'memory') db.exec('PRAGMA journal_mode=WAL');
      return;
    } catch (error) {
      const remaining = deadline - performance.now();
      if (error.code !== 'ERR_SQLITE_ERROR' || (error.errcode & 255) !== 5 || remaining <= 0) throw error;
      Atomics.wait(pause, 0, 0, Math.min(25, remaining));
    }
  }
}

export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  try {
  // Short waits during the bounded WAL transition, then normal write contention budget.
  db.exec('PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON;');
  enableWal(db);
  db.exec('PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  `);
  transaction(db, () => {
    // Recheck only after acquiring the writer lock; server and CLI may open together.
    let version = db.prepare('SELECT max(version) AS version FROM schema_migrations').get().version ?? 0;
    if (version > 2) throw new Error('Database schema is newer than this server.');
    if (version === 0) {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','content','moderator','admin')),
        suspended INTEGER NOT NULL DEFAULT 0 CHECK(suspended IN (0,1)), version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE TABLE courses(id TEXT PRIMARY KEY, data_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published','withdrawn')), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE course_versions(id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id), version INTEGER NOT NULL, data_json TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(course_id,version));
      CREATE TABLE rooms(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)), version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE memberships(room_id TEXT NOT NULL REFERENCES rooms(id), user_id TEXT NOT NULL REFERENCES users(id), joined_at TEXT NOT NULL, joined_after_seq INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), PRIMARY KEY(room_id,user_id));
      CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, room_id TEXT NOT NULL REFERENCES rooms(id), author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, client_message_id TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)), created_at TEXT NOT NULL, UNIQUE(author_id,client_message_id));
      CREATE INDEX messages_room_seq ON messages(room_id,seq);
      CREATE TABLE posts(id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE comments(id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id), author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)), created_at TEXT NOT NULL);
      CREATE INDEX comments_post ON comments(post_id,created_at);
      CREATE TABLE blocks(blocker_id TEXT NOT NULL REFERENCES users(id), blocked_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, PRIMARY KEY(blocker_id,blocked_id));
      CREATE TABLE reports(id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id), target_type TEXT NOT NULL CHECK(target_type IN ('message','post')), target_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE INDEX reports_target ON reports(target_type,target_id);
      CREATE TABLE audit(id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE feedback(id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), category TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    db.prepare('INSERT INTO rooms(id,name,description) VALUES(?,?,?)').run('travel-questions', '여행 질문', '코스와 여행 준비에 관한 질문을 나누는 회원 대화방입니다. 실시간 구조·상담을 보장하지 않습니다.');
    db.prepare('INSERT INTO rooms(id,name,description) VALUES(?,?,?)').run('community-lounge', '자유 대화', '여행 경험과 관심사를 나눕니다. 정확한 위치·연락처 등 개인정보 공유에 주의하세요.');
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)').run(new Date().toISOString());
    version = 1;
    }
    if (version === 1) {
      db.exec(`
        CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
        CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
        CREATE TRIGGER course_versions_no_update BEFORE UPDATE ON course_versions BEGIN SELECT RAISE(ABORT,'course_versions is append-only'); END;
        CREATE TRIGGER course_versions_no_delete BEFORE DELETE ON course_versions BEGIN SELECT RAISE(ABORT,'course_versions is append-only'); END;
        ALTER TABLE reports RENAME TO reports_v1;
        CREATE TABLE reports(id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id), target_type TEXT NOT NULL CHECK(target_type IN ('message','post','comment')), target_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
        INSERT INTO reports SELECT * FROM reports_v1;
        DROP TABLE reports_v1;
        CREATE INDEX reports_target ON reports(target_type,target_id);
      `);
      db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(2,?)').run(new Date().toISOString());
    }
  }); } catch (error) { try { db.close(); } catch { /* Preserve the initialization error. */ } throw error; }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function addAudit(db, { actorId, action, targetId, reason, details = {}, at }) {
  return db.prepare('INSERT INTO audit(id,actor_id,action,target_id,reason,details_json,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), actorId, action, targetId, reason, JSON.stringify(details), at);
}

export function grantAdmin(db, username, at = new Date().toISOString()) {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username.toLowerCase());
  if (!user) throw new Error('Registered user not found. Register your own account first.');
  if (user.suspended) throw new Error('Cannot promote a suspended account.');
  transaction(db, () => {
    db.prepare("UPDATE users SET role='admin',version=version+1 WHERE id=?").run(user.id);
    addAudit(db, { actorId: 'local-os-operator', action: 'role.grant-admin', targetId: user.id, reason: 'Explicit local OS CLI bootstrap', details: { previousRole: user.role, nextRole: 'admin' }, at });
  });
  return { id: user.id, username: user.username };
}
