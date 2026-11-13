import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

// Existing process values take precedence, then .env.local, then .env.
for (const name of ['.env.local', '.env']) {
  try {
    loadEnvFile(fileURLToPath(new URL(`../${name}`, import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
