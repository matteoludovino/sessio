# Sessio

Scheduling for psychology practices: multi-practitioner calendars, rooms, weekly recurring sessions, automatic reminders with confirmation links, and confidential clinical notes.

> Work in progress. See the roadmap below.

## Stack
NestJS 12 · Drizzle ORM · PostgreSQL 16 · React + Vite · pnpm workspaces

## Local development
```bash
docker compose up -d                 # PostgreSQL (port 5434) + Mailpit (UI on :8025)
cp apps/api/.env.example apps/api/.env
pnpm install
pnpm --filter @sessio/api start:dev  # API on http://localhost:3100/api
```

## Tests
```bash
pnpm --filter @sessio/api test       # unit
pnpm --filter @sessio/api test:e2e   # end-to-end against a real PostgreSQL (Testcontainers, needs Docker)
```
