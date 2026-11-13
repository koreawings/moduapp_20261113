import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// All application instances and the admin CLI share this lock. Authorization
// checks and their changes remain atomic; readers may run together.
const REQUEST_LOCK = '542553850757391';
const context = new AsyncLocalStorage();
const TABLES = ['schema_migrations', 'users', 'sessions', 'courses', 'course_versions', 'rooms',
  'memberships', 'messages', 'posts', 'comments', 'blocks', 'reports', 'audit', 'feedback'];

function safeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    const error = new RangeError('Database integer exceeds JavaScript safe integer range.');
    error.code = 'DATABASE_INTEGER_RANGE';
    throw error;
  }
  return number;
}

const resultTypes = {
  getTypeParser(oid, format) {
    if (oid === 20 && format !== 'binary') return safeInteger;
    return pg.types.getTypeParser(oid, format);
  },
};

// SQL text comes from application code. Keep quoted text and comments intact.
function placeholders(sql) {
  let index = 0;
  const tokens = /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\r\n]*|\/\*[\s\S]*?\*\/|\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$|\?/g;
  return sql.replace(tokens, token => token === '?' ? `$${++index}` : token);
}

function connectionPool(databaseUrl, sslCaPath, maxConnections) {
  let parsed;
  try { parsed = new URL(databaseUrl); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://.');
  }
  if (!parsed.hostname || !parsed.username || parsed.pathname.length <= 1) {
    throw new Error('DATABASE_URL must include a host, username, and database name.');
  }
  let user, password, database;
  try {
    user = decodeURIComponent(parsed.username);
    password = decodeURIComponent(parsed.password);
    database = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error('DATABASE_URL contains invalid percent-encoding.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const disableSsl = local && parsed.searchParams.get('sslmode') === 'disable';
  // Explicit fields prevent URL query parameters from overriding host or TLS.
  const ssl = disableSsl ? false : {
    rejectUnauthorized: true,
    ...(sslCaPath ? { ca: readFileSync(sslCaPath, 'utf8') } : {}),
  };
  const pool = new pg.Pool({
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: parsed.port ? Number(parsed.port) : 5432,
    user,
    password,
    database,
    ssl,
    max: maxConnections,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
    application_name: 'kj-trail',
  });
  pool.on('error', error => {
    console.error('[database]', error.code ?? error.name, 'PostgreSQL connection failed.');
  });
  return pool;
}

export function createPostgresDatabase({ databaseUrl, sslCaPath, maxConnections = 10, onPool,
  pool = connectionPool(databaseUrl, sslCaPath, maxConnections) } = {}) {
  try { onPool?.(pool); }
  catch (error) {
    void pool.end().catch(() => {});
    throw error;
  }
  const owner = {};
  let initialization;
  let closing;
  let savepointSequence = 0;

  function ready() {
    initialization ??= (async () => {
      const missing = await pool.query({
        text: "SELECT name FROM unnest($1::text[]) AS expected(name) WHERE to_regclass('kj_trail.' || name) IS NULL",
        values: [TABLES],
      });
      if (missing.rows.length) {
        throw new Error(`KJ Trail PostgreSQL tables are missing: ${missing.rows.map(row => row.name).join(', ')}. Run db/schema.sql first.`);
      }
      const result = await pool.query({
        text: 'SELECT max(version) AS version FROM kj_trail.schema_migrations',
        types: resultTypes,
      });
      if (result.rows[0]?.version !== 2) {
        throw new Error('KJ Trail PostgreSQL schema version 2 is required. Run db/schema.sql first.');
      }
    })();
    return initialization;
  }

  async function request({ write }, callback) {
    const current = context.getStore();
    if (current?.owner === owner) {
      if (write && !current.write) throw new Error('Cannot write inside a read-only database request.');
      return callback();
    }
    await ready();
    const client = await pool.connect();
    let active = false;
    let discard = false;
    try {
      await client.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
      active = true;
      await client.query(`SELECT
        pg_catalog.set_config('lock_timeout', '5s', true),
        pg_catalog.set_config('statement_timeout', '15s', true),
        pg_catalog.set_config('idle_in_transaction_session_timeout', '15s', true),
        pg_catalog.set_config('search_path', 'pg_catalog,kj_trail,pg_temp', true)`);
      const lock = write ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared';
      await client.query(`SELECT pg_catalog.${lock}($1::bigint)`, [REQUEST_LOCK]);
      const result = await context.run({ owner, client, write }, callback);
      await client.query('COMMIT');
      active = false;
      return result;
    } catch (error) {
      if (active) {
        try { await client.query('ROLLBACK'); }
        catch { discard = true; }
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  async function query(sql, values = []) {
    const current = context.getStore();
    if (current?.owner !== owner) {
      return request({ write: true }, () => query(sql, values));
    }
    return current.client.query({ text: sql, values, types: resultTypes });
  }

  async function transaction(callback) {
    const current = context.getStore();
    if (current?.owner !== owner) return request({ write: true }, callback);
    if (!current.write) throw new Error('Cannot write inside a read-only database request.');
    const savepoint = `kj_nested_${++savepointSequence}`;
    await current.client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await callback();
      await current.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await current.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await current.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  return {
    dialect: 'postgresql',
    ready,
    request,
    transaction,
    prepare(sql) {
      const text = placeholders(sql);
      return {
        async get(...values) { return (await query(text, values)).rows[0]; },
        async all(...values) { return (await query(text, values)).rows; },
        async run(...values) { return { changes: (await query(text, values)).rowCount }; },
      };
    },
    exec: sql => query(sql),
    close() {
      closing ??= pool.end();
      return closing;
    },
  };
}
