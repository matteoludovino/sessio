# ADR 0003: Server-side sessions in a cookie, not JWTs

**Status:** accepted · **Date:** 2026-11-10

## Context
Staff sign in from a browser on the same site as the API. When someone leaves the clinic, the owner deactivates them, and access must end **now**, not when a token expires.

## Decision
- Opaque session id in a `__Host-` cookie (HttpOnly, Secure, SameSite=Lax), sessions stored in PostgreSQL through `@nestjs/authentication`: absolute lifetime 12 h, idle timeout 2 h.
- Deactivating a user revokes all their sessions in the same request.
- CSRF protection with trusted origins, security headers on every response.
- Passwords hashed with scrypt (Node's built-in), with rehash on sign-in if the parameters change.
- In production the web app reaches the API through a same-origin rewrite (`/api` on Vercel → Render), so the cookie stays first-party.

## Consequences
- One database read per request to load the session: negligible at this scale.
- No refresh-token rotation, reuse detection or denylist to build.

## Rejected alternatives
- Access JWT + rotating refresh token (the original plan): more moving parts to get the same revocation guarantee.
- argon2: a native dependency for no practical gain over scrypt here.
