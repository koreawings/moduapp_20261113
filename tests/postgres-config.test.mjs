import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPostgresDatabase } from '../server/postgres-database.mjs';

// Capture constructor arguments without opening a socket or reading real env.
function configuredDatabase(databaseUrl) {
  const OriginalPool = pg.Pool;
  let options;
  pg.Pool = class {
    constructor(config) { options = config; }
    on() {}
    async end() {}
  };
  try {
    return { database: createPostgresDatabase({ databaseUrl }), options };
  } finally {
    pg.Pool = OriginalPool;
  }
}

test('remote PostgreSQL TLS and host cannot be overridden by URL query options', async () => {
  const { database, options } = configuredDatabase(
    'postgresql://app%40tenant:p%40ss%25word@db.example.invalid:6543/trail'
    + '?ssl=0&ssl=no-verify&sslmode=disable&host=localhost&sslrootcert=missing.crt&sslcert=missing.crt&sslkey=missing.key',
  );
  try {
    assert.equal(options.connectionString, undefined);
    assert.equal(options.host, 'db.example.invalid');
    assert.equal(options.port, 6543);
    assert.equal(options.user, 'app@tenant');
    assert.equal(options.password, 'p@ss%word');
    assert.equal(options.database, 'trail');
    assert.equal(options.ssl.rejectUnauthorized, true);
    const parsed = new pg.Client(options).connectionParameters;
    assert.equal(parsed.host, 'db.example.invalid');
    assert.equal(parsed.ssl.rejectUnauthorized, true);
  } finally {
    await database.close();
  }
});

test('TLS disable is accepted only for an explicit loopback URL', async () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const { database, options } = configuredDatabase(`postgresql://app:pass@${host}/trail?sslmode=disable&host=remote.invalid`);
    try {
      assert.equal(options.host, host.replace(/^\[|\]$/g, ''));
      assert.equal(options.port, 5432);
      assert.equal(options.ssl, false);
    } finally {
      await database.close();
    }
  }
  const { database, options } = configuredDatabase('postgresql://app:pass@localhost/trail');
  try { assert.equal(options.ssl.rejectUnauthorized, true); }
  finally { await database.close(); }
});

test('invalid PostgreSQL connection URLs fail without printing credentials', () => {
  const privateValue = 'password-must-never-appear';
  const invalid = [
    `${privateValue} is not a URL`,
    `https://app:${privateValue}@db.example.invalid/trail`,
    `postgresql://app:${privateValue}@db.example.invalid`,
    `postgresql://app:${privateValue}%ZZ@db.example.invalid/trail`,
    'postgresql:///trail',
  ];
  for (const databaseUrl of invalid) {
    assert.throws(() => configuredDatabase(databaseUrl), error => {
      assert.match(error.message, /^DATABASE_URL /);
      assert.equal(error.message.includes(privateValue), false);
      assert.equal(error.message.includes(databaseUrl), false);
      return true;
    });
  }
});
