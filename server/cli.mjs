import './env.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAppDatabase, grantAppAdmin } from './app-database.mjs';
const [command, username, ...extra] = process.argv.slice(2);
if (command !== 'grant-admin' || !username || extra.length || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/.test(username)) {
  console.error('Usage: npm run grant-admin -- your-registered-username'); process.exitCode = 1;
} else {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dbPath = process.env.KJ_DB_PATH ?? resolve(root, 'data/kj-trail.sqlite');
  const db = openAppDatabase({ dbPath, databaseUrl: process.env.DATABASE_URL,
    sslCaPath: process.env.DATABASE_SSL_CA ? resolve(root, process.env.DATABASE_SSL_CA) : undefined });
  try { const result = await grantAppAdmin(db, username); console.log(`Administrator role granted to registered user: ${result.username}. Refresh the session view.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await db.close(); }
}
