# ADR 0001: Overlaps are refused by the database, not only by the API

**Status:** accepted · **Date:** 2026-11-10

## Context
Two people booking the same slot at the same moment is the classic scheduling bug: both requests read "free", both insert. A check-then-insert in application code cannot prevent it without a lock, and in a clinic three different things can't overlap: the psychologist's time, the room and the patient.

## Decision
- PostgreSQL **exclusion constraints** (`EXCLUDE USING gist`, with `btree_gist`) over `tstzrange(starts_at, blocked_until)`, one per psychologist and one per room, only for statuses that hold the slot (`scheduled`, `confirmed`, `completed`, `no_show`).
- `blocked_until` = end + the clinic's buffer **at booking time**, so changing the buffer later never reshapes existing sessions.
- The API still checks first (`SlotValidator`) to explain *what* is in the way (409 with the conflicting sessions); the constraint is the final word, also between racing requests. Error `23P01` is mapped to 409.
- Every reference carries `clinic_id` in a composite foreign key, so a row can't point at another clinic's room or patient either.

## Consequences
- The e2e suite fires 20 simultaneous bookings at one slot against a real PostgreSQL: exactly one wins, 19 get 409. In every measured run, one or two of the losers had passed the API's check at the same instant and were stopped by the constraint itself. Another test inserts an overlap directly in the database, bypassing the API, and it is refused.
- The constraints live in hand-written migrations (`drizzle/0002`, `0004`): the ORM can't model them.
- The overlap rule exists twice (validator and constraint), and both must change together.

## Rejected alternatives
- `SELECT ... FOR UPDATE` on the psychologist row: serializes bookings per psychologist but not per room, and is easy to forget on a new code path.
- `SERIALIZABLE` transactions: correct, but retries leak into every write and the error tells nothing about the conflict.
