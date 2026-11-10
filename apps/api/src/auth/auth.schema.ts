import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const at = () => timestamp({ withTimezone: true, mode: 'date' });

/**
 * Sign-in sessions kept by @nestjs/authentication (named auth_sessions so they are never
 * confused with therapy sessions). The id is the SHA-256 of the cookie token, never the token.
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text().primaryKey(),
    userId: text().notNull(),
    createdAt: at().notNull(),
    expiresAt: at().notNull(),
    lastActiveAt: at().notNull(),
    mfa: text({ enum: ['pending', 'verified'] }),
    metadata: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [index('auth_sessions_user_id_idx').on(t.userId), index('auth_sessions_expires_at_idx').on(t.expiresAt)],
);
