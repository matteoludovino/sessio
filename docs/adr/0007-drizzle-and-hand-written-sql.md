# ADR 0007: Drizzle ORM, with hand-written SQL where the rules live

**Status:** accepted · **Date:** 2026-11-10

## Context
The core rules depend on PostgreSQL features: exclusion constraints, partial conditions, composite foreign keys, `FOR UPDATE SKIP LOCKED`, conditional updates. The ORM must not hide them.

## Decision
- Drizzle (node-postgres driver, snake_case columns) for typed queries close to SQL, and generated migrations for ordinary tables.
- Custom migrations for what Drizzle can't model (exclusion constraints, the outbox schema).
- State transitions are conditional updates (`UPDATE ... WHERE status IN (...)`): two concurrent "confirm" and "cancel" can't both win.
- Migrations run on container start (`dist/db/migrate.js` before the API): a deploy with a failing migration never serves traffic.

## Consequences
- Real PostgreSQL in tests (Testcontainers): none of this exists in mocks or SQLite.
- Database error codes (`23P01`, `23505`, `23503`) are mapped to HTTP responses in one exception filter.

## Rejected alternatives
- Prisma (the original plan): exclusion constraints and conditional updates would have needed raw SQL on most of the important paths anyway.
