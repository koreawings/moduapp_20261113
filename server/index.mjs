import './env.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
const root = fileURLToPath(new URL('../', import.meta.url));
const app = createApp({
  ...(process.env.KJ_DB_PATH ? { dbPath: process.env.KJ_DB_PATH } : {}),
  databaseUrl: process.env.DATABASE_URL,
  sslCaPath: process.env.DATABASE_SSL_CA ? resolve(root, process.env.DATABASE_SSL_CA) : undefined,
  onError: error => console.error('[server]', error.code ?? error.name, 'Request failed; no request content logged.'),
});
try {
  await app.listen(port, '127.0.0.1');
  console.log(`KJ Trail local server: http://127.0.0.1:${port} (${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'})`);
} catch (error) {
  console.error('[server]', error.code ?? error.name, 'Startup failed. Check database connection and schema settings.');
  await app.close();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
