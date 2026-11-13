import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './database.mjs';
import { createPostgresDatabase } from './postgres-database.mjs';

export function openAppDatabase({ dbPath, databaseUrl, sslCaPath, pool } = {}) {
  if (databaseUrl || pool) return createPostgresDatabase({ databaseUrl, sslCaPath, pool });

  const raw = openDatabase(dbPath);
  const context = new AsyncLocalStorage();
  let pending = Promise.resolve();
  let closing;
  let savepointSequence = 0;

  function request({ write }, callback) {
    const current = context.getStore();
    if (current) {
      if (write && !current.write) throw new Error('Cannot write inside a read-only database request.');
      return callback();
    }
    const result = pending.then(async () => {
      if (write) raw.exec('BEGIN IMMEDIATE');
      try {
        const value = await context.run({ write }, callback);
        if (write) raw.exec('COMMIT');
        return value;
      } catch (error) {
        if (write) raw.exec('ROLLBACK');
        throw error;
      }
    });
    pending = result.catch(() => {});
    return result;
  }

  async function transaction(callback) {
    const current = context.getStore();
    if (!current) return request({ write: true }, callback);
    if (!current.write) throw new Error('Cannot write inside a read-only database request.');
    const savepoint = `kj_nested_${++savepointSequence}`;
    raw.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = await callback();
      raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  return {
    dialect: 'sqlite',
    raw,
    ready: async () => {},
    request,
    transaction,
    prepare: sql => raw.prepare(sql),
    exec: sql => raw.exec(sql),
    close() {
      closing ??= pending.then(() => raw.close());
      return closing;
    },
  };
}

export function grantAppAdmin(db, username, at = new Date().toISOString()) {
  return db.request({ write: true }, async () => {
    const user = await db.prepare('SELECT * FROM users WHERE lower(username)=?').get(username.toLowerCase());
    if (!user) throw new Error('Registered user not found. Register your own account first.');
    if (user.suspended) throw new Error('Cannot promote a suspended account.');
    await db.prepare("UPDATE users SET role='admin',version=version+1 WHERE id=?").run(user.id);
    await db.prepare('INSERT INTO audit(id,actor_id,action,target_id,reason,details_json,created_at) VALUES(?,?,?,?,?,?,?)').run(
      randomUUID(), 'local-os-operator', 'role.grant-admin', user.id,
      'Explicit server CLI bootstrap', JSON.stringify({ previousRole: user.role, nextRole: 'admin' }), at,
    );
    return { id: user.id, username: user.username };
  });
}
