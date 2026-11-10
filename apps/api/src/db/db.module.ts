import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DrizzleModule } from '@nestjs/drizzle';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Env } from '../config/env.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
/** A Drizzle transaction, as `db.transaction()` hands it to its callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** The database itself or a transaction: repositories accept either, so callers compose them. */
export type Executor = Database | Transaction;

@Global()
@Module({
  imports: [
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        drizzle,
        connection: config.get('DATABASE_URL', { infer: true }),
        schema,
        casing: 'snake_case' as const,
      }),
    }),
  ],
})
export class DbModule {}
