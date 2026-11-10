import { Injectable } from '@nestjs/common';
import { AuthenticationStorage, type SessionRecord, type SessionStore } from '@nestjs/authentication';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, eq, lt, lte } from 'drizzle-orm';
import type { Database } from '../db/db.module.js';
import { authSessions } from './auth.schema.js';

type Row = typeof authSessions.$inferSelect;

/**
 * Sign-in sessions in PostgreSQL. Every method that decides whether something works once is a
 * single conditional statement, so the guarantees hold with any number of API instances.
 * Verified by the package's contract suite, races included (test/auth-session-store.e2e-spec.ts).
 */
@Injectable()
export class DrizzleSessionStore implements SessionStore {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ sessions: this });
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const [row] = await this.db.select().from(authSessions).where(eq(authSessions.id, id));
    return row && toRecord(row);
  }

  async createSession(record: SessionRecord): Promise<void> {
    const { id, userId, createdAt, expiresAt, lastActiveAt, mfa, metadata } = record;
    await this.db.insert(authSessions).values({ id, userId, createdAt, expiresAt, lastActiveAt, mfa, metadata });
    // Opportunistic cleanup keeps the table bounded without a scheduled job.
    await this.db.delete(authSessions).where(lte(authSessions.expiresAt, createdAt));
  }

  async touchSession(id: string, lastActiveAt: Date): Promise<void> {
    // Conditional: a session deleted by a sign-out stays deleted.
    await this.db
      .update(authSessions)
      .set({ lastActiveAt })
      .where(and(eq(authSessions.id, id), lt(authSessions.lastActiveAt, lastActiveAt)));
  }

  /** Whether this call deleted it: of two rotations, or a rotation and a sign-out, one wins. */
  async deleteSession(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(authSessions)
      .where(eq(authSessions.id, id))
      .returning({ id: authSessions.id });
    return deleted.length > 0;
  }

  async listUserSessions(userId: string): Promise<SessionRecord[]> {
    const rows = await this.db.select().from(authSessions).where(eq(authSessions.userId, userId));
    return rows.map(toRecord);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.userId, userId));
  }
}

function toRecord(row: Row): SessionRecord {
  const { mfa, metadata, ...rest } = row;
  return { ...rest, ...(mfa && { mfa }), ...(metadata && { metadata }) };
}
