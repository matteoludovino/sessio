# ADR 0002: Recurring sessions are materialized up to a rolling horizon

**Status:** accepted · **Date:** 2026-11-10

## Context
Therapy is weekly: "every Tuesday at 08:00 until discharge". Each occurrence must still obey every rule (working hours, time off, overlaps), and staff edit "only this one" or "this and the following".

## Decision
- A series row holds the rule (anchor date, local start minute, interval of 1 or 2 weeks, optional end date or count).
- Occurrences are **real appointment rows**, generated up to a horizon of 12 weeks and extended by an idempotent job. `(series_id, occurrence_date)` is unique, so concurrent runs can't create a date twice (`FOR UPDATE SKIP LOCKED` per series).
- Creation is all or nothing: every conflicting date is reported at once (409 with the list), and the caller may retry with `skipConflicts`.
- "This and following" ends the old series before the occurrence and starts a new one from it; history stays untouched.
- Times are planned in the clinic's timezone (local wall clock), stored in UTC.

## Consequences
- The calendar, the overlap constraints and the reminders work on plain rows: nothing special for recurring sessions.
- An open-ended series needs the job to keep running; free hosting sleeps, hence the external scheduler (ADR 0004).

## Rejected alternatives
- Expanding an RRULE at read time: the exclusion constraints couldn't see virtual occurrences, and every query would need the expansion logic.
