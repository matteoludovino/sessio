import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Applies pending migrations, then exits: the container runs it before starting the API, so a
 * deploy with a failing migration never serves traffic. Safe to run on every boot.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const pool = new Pool({ connectionString, max: 1 });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  console.log('migrations: up to date');
} finally {
  await pool.end();
}
