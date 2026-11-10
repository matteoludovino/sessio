# ADR 0005: Patient links are signed and bound to the session's start time

**Status:** accepted · **Date:** 2026-11-10

## Context
Patients have no account. The reminder carries a link to confirm or cancel; it must not be guessable, must not reveal anything else, and must stop working when it no longer describes the session.

## Decision
- The token is `base64url(appointmentId.startsAtMs)` + HMAC-SHA256 with a server secret (`LINK_SECRET`). Nothing is stored.
- It is valid only while the session still starts at that instant and the action is allowed: a rescheduled session invalidates old links automatically, and confirm/cancel are refused once the session has started.
- Cancelling through the link applies the clinic's late-cancellation policy, and the page warns *before* the patient confirms that it may be chargeable.
- The page and the e-mail use neutral wording: no session type, nothing clinical.
- `Referrer-Policy: no-referrer` on the web app, so the token never leaks in a Referer header.

## Consequences
- Confirming twice is harmless (idempotent); the link isn't single-use, which matches what patients expect ("confirm", then later "actually I can't go").
- Rotating `LINK_SECRET` invalidates every outstanding link.

## Rejected alternatives
- Random single-use tokens in a table: storage and cleanup, and a confirmed patient couldn't cancel later with the same e-mail.
