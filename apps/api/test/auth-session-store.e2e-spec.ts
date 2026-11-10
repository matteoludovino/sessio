import { AuthenticationStorage } from '@nestjs/authentication';
import { authenticationStoreContract } from '@nestjs/authentication/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { inject } from 'vitest';
import { DrizzleSessionStore } from '../src/auth/drizzle-session.store.js';
import type { Database } from '../src/db/db.module.js';
import * as schema from '../src/db/schema.js';

// The package's own rules for a session store, with the races: on a pool, the calls really race.
describe('DrizzleSessionStore (contract, PostgreSQL)', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    pool = new Pool({ connectionString: inject('databaseUrl'), max: 10 });
    db = drizzle({ client: pool, schema, casing: 'snake_case' });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function emptyStore() {
    await db.execute(sql`TRUNCATE auth_sessions`);
    return { sessions: new DrizzleSessionStore(db, new AuthenticationStorage()) };
  }

  for (const c of authenticationStoreContract(emptyStore, { contracts: ['sessions'], concurrent: true })) {
    it(c.name, () => c.run());
  }
});
