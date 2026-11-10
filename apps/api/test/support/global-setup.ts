import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { TestProject } from 'vitest/node';

let container: StartedPostgreSqlContainer;

/** One real PostgreSQL for the whole e2e run, migrated once: constraints don't exist in mocks. */
export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();
  // A second database for the demo reset, which truncates everything it sees.
  const admin = new Pool({ connectionString: url });
  await admin.query('create database demo');
  await admin.end();
  const demoUrl = Object.assign(new URL(url), { pathname: '/demo' }).toString();
  for (const connectionString of [url, demoUrl]) {
    const pool = new Pool({ connectionString });
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    await pool.end();
  }
  project.provide('databaseUrl', url);
  project.provide('demoDatabaseUrl', demoUrl);
}

export async function teardown() {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    demoDatabaseUrl: string;
  }
}
