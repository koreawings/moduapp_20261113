-- KJ Trail / PostgreSQL schema for the existing Node API.
-- Run once in Supabase SQL Editor as postgres.
-- The dedicated schema and role must not already exist.
-- The Node API remains responsible for user/session/permission checks.
-- Application connection uses kj_trail_backend after a private password is set.
-- Keep kj_trail outside the Data API's exposed schemas.

BEGIN;

CREATE SCHEMA kj_trail;
CREATE ROLE kj_trail_backend
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

-- Text IDs include existing room slugs. JSON and UTC ISO date strings
-- retain the representations consumed by the current Node API.
CREATE TABLE kj_trail.schema_migrations (
  version integer PRIMARY KEY,
  applied_at text NOT NULL
);

CREATE TABLE kj_trail.users (
  id text PRIMARY KEY,
  username text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'content', 'moderator', 'admin')),
  suspended smallint NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1)),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at text NOT NULL
);
CREATE UNIQUE INDEX users_username_ci ON kj_trail.users (lower(username));

CREATE TABLE kj_trail.sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES kj_trail.users(id),
  expires_at bigint NOT NULL,
  created_at text NOT NULL
);
COMMENT ON COLUMN kj_trail.sessions.expires_at IS 'Unix epoch milliseconds';
CREATE INDEX sessions_user ON kj_trail.sessions(user_id);
CREATE INDEX sessions_expiry ON kj_trail.sessions(expires_at);

CREATE TABLE kj_trail.courses (
  id text PRIMARY KEY,
  data_json text NOT NULL CHECK (jsonb_typeof(data_json::jsonb) = 'object'),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'withdrawn')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX courses_status ON kj_trail.courses(status);

CREATE TABLE kj_trail.course_versions (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES kj_trail.courses(id),
  version integer NOT NULL CHECK (version > 0),
  data_json text NOT NULL CHECK (jsonb_typeof(data_json::jsonb) = 'object'),
  actor_id text NOT NULL REFERENCES kj_trail.users(id),
  reason text NOT NULL,
  created_at text NOT NULL,
  UNIQUE (course_id, version)
);
CREATE INDEX course_versions_actor ON kj_trail.course_versions(actor_id);

CREATE TABLE kj_trail.rooms (
  rowid bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  locked smallint NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE kj_trail.memberships (
  room_id text NOT NULL REFERENCES kj_trail.rooms(id),
  user_id text NOT NULL REFERENCES kj_trail.users(id),
  joined_at text NOT NULL,
  joined_after_seq bigint NOT NULL,
  active smallint NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX memberships_user ON kj_trail.memberships(user_id);

CREATE TABLE kj_trail.messages (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id text NOT NULL UNIQUE,
  room_id text NOT NULL REFERENCES kj_trail.rooms(id),
  author_id text NOT NULL REFERENCES kj_trail.users(id),
  body text NOT NULL,
  client_message_id text NOT NULL,
  hidden smallint NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at text NOT NULL,
  UNIQUE (author_id, client_message_id)
);
CREATE INDEX messages_room_seq ON kj_trail.messages(room_id, seq);

CREATE TABLE kj_trail.posts (
  id text PRIMARY KEY,
  author_id text NOT NULL REFERENCES kj_trail.users(id),
  title text NOT NULL,
  body text NOT NULL,
  hidden smallint NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at text NOT NULL
);
CREATE INDEX posts_author ON kj_trail.posts(author_id);
CREATE INDEX posts_created ON kj_trail.posts(created_at DESC);

CREATE TABLE kj_trail.comments (
  rowid bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES kj_trail.posts(id),
  author_id text NOT NULL REFERENCES kj_trail.users(id),
  body text NOT NULL,
  hidden smallint NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at text NOT NULL
);
CREATE INDEX comments_post ON kj_trail.comments(post_id, created_at, rowid);
CREATE INDEX comments_author ON kj_trail.comments(author_id);

CREATE TABLE kj_trail.blocks (
  blocker_id text NOT NULL REFERENCES kj_trail.users(id),
  blocked_id text NOT NULL REFERENCES kj_trail.users(id),
  created_at text NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX blocks_blocked ON kj_trail.blocks(blocked_id);

CREATE TABLE kj_trail.reports (
  id text PRIMARY KEY,
  reporter_id text NOT NULL REFERENCES kj_trail.users(id),
  target_type text NOT NULL CHECK (target_type IN ('message', 'post', 'comment')),
  target_id text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at text NOT NULL
);
CREATE INDEX reports_target ON kj_trail.reports(target_type, target_id);
CREATE INDEX reports_reporter ON kj_trail.reports(reporter_id);
CREATE INDEX reports_status ON kj_trail.reports(status, created_at);

CREATE TABLE kj_trail.audit (
  rowid bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_id text NOT NULL,
  reason text NOT NULL,
  details_json text NOT NULL CHECK (jsonb_typeof(details_json::jsonb) = 'object'),
  created_at text NOT NULL
);
CREATE INDEX audit_created ON kj_trail.audit(created_at DESC, rowid DESC);

CREATE TABLE kj_trail.feedback (
  id text PRIMARY KEY,
  author_id text NOT NULL REFERENCES kj_trail.users(id),
  category text NOT NULL,
  body text NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX feedback_author ON kj_trail.feedback(author_id);
CREATE INDEX feedback_created ON kj_trail.feedback(created_at DESC);

-- Preserve append-only audit and course history.
CREATE FUNCTION kj_trail.reject_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER audit_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON kj_trail.audit
  FOR EACH STATEMENT EXECUTE FUNCTION kj_trail.reject_history_mutation();
CREATE TRIGGER course_versions_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON kj_trail.course_versions
  FOR EACH STATEMENT EXECUTE FUNCTION kj_trail.reject_history_mutation();

-- Browser API roles receive no access to the custom-auth tables.
REVOKE ALL ON SCHEMA kj_trail FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA kj_trail FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA kj_trail FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA kj_trail FROM PUBLIC, anon, authenticated, service_role;

-- This DB role is the trusted Node server. End-user authorization stays in /api.
GRANT USAGE ON SCHEMA kj_trail TO kj_trail_backend;
GRANT SELECT ON ALL TABLES IN SCHEMA kj_trail TO kj_trail_backend;
GRANT INSERT, UPDATE ON
  kj_trail.users, kj_trail.courses, kj_trail.memberships,
  kj_trail.messages, kj_trail.posts, kj_trail.comments, kj_trail.reports
  TO kj_trail_backend;
GRANT INSERT, DELETE ON kj_trail.sessions, kj_trail.blocks TO kj_trail_backend;
GRANT INSERT ON kj_trail.course_versions, kj_trail.audit, kj_trail.feedback TO kj_trail_backend;
GRANT UPDATE ON kj_trail.rooms TO kj_trail_backend;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA kj_trail TO kj_trail_backend;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'schema_migrations', 'users', 'sessions', 'courses', 'course_versions',
    'rooms', 'memberships', 'messages', 'posts', 'comments',
    'blocks', 'reports', 'audit', 'feedback'
  ] LOOP
    EXECUTE format('ALTER TABLE kj_trail.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY backend_access ON kj_trail.%I FOR ALL TO kj_trail_backend USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END;
$$;

INSERT INTO kj_trail.rooms(id, name, description) VALUES
  ('travel-questions', '여행 질문', '코스와 여행 준비에 관한 질문을 나누는 회원 대화방입니다. 실시간 구조·상담을 보장하지 않습니다.'),
  ('community-lounge', '자유 대화', '여행 경험과 관심사를 나눕니다. 정확한 위치·연락처 등 개인정보 공유에 주의하세요.');

INSERT INTO kj_trail.schema_migrations(version, applied_at)
VALUES (2, to_char(current_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

COMMIT;

-- Verify in SQL Editor. Expect tables = 14, rls_enabled = 14, rooms = 2, courses = 0.
SELECT count(*) AS tables,
       count(*) FILTER (WHERE c.relrowsecurity) AS rls_enabled
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'kj_trail' AND c.relkind = 'r';
SELECT count(*) AS rooms FROM kj_trail.rooms;
SELECT count(*) AS courses FROM kj_trail.courses;

-- Set the backend's private password separately before connecting.
-- Replace the placeholder yourself, then execute only that statement.
-- ALTER ROLE kj_trail_backend LOGIN PASSWORD '<YOUR_OWN_STRONG_PASSWORD>';
-- Store the connection string only in a server-side DATABASE_URL.
-- Use qualified table names (kj_trail.users, etc.) in the PostgreSQL adapter.
