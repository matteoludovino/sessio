# ADR 0004: Reminders through a transactional outbox, triggered by an external scheduler

**Status:** accepted · **Date:** 2026-11-10

## Context
A reminder must go out once, a configurable number of hours before each session (48 h by default), and never for a session that was cancelled or moved meanwhile. The demo runs on free hosting that sleeps after 15 minutes, and there is no Redis.

## Decision
- **The scheduler reads the current state**: a job selects sessions entering the reminder window (`FOR UPDATE SKIP LOCKED`) and queues one outbox message each, recording the start time it was queued for. A rescheduled session gets a new reminder; a cancelled one gets none.
- Messages go through `@nestjs/outbox` (PostgreSQL store): written in the same transaction as the change that caused them, published with retries and backoff, de-duplicated by an inbox on the consumer side.
- The job runs in-process every 5 minutes while the API is awake, and hourly from **GitHub Actions** (`POST /api/internal/jobs/run`, bearer secret, constant-time comparison). Every step is idempotent, so both triggers may overlap.

## Consequences
- With 48 h of lead time, hourly precision is plenty; documented as a limit of the free deployment.
- Waking the API hourly also keeps the Neon database within its free compute hours (it sleeps between runs).
- GitHub disables scheduled workflows after 60 days without repository activity.

## Rejected alternatives
- Queueing the reminder at booking time with a delay: it would need cancelling on every reschedule or cancellation, and a queue service.
- A Redis-backed queue (BullMQ): another paid or sleeping service for a few messages a day.
