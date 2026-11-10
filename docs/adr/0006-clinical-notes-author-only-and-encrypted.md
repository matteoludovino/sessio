# ADR 0006: Clinical notes are visible to their author only, encrypted, append-only and audited

**Status:** accepted · **Date:** 2026-11-10

## Context
Psychology records are sensitive by nature. Good practice (inspired by the Brazilian Federal Council of Psychology's guidance on records) is that only the psychologist in charge reads them; the clinic's owner and front desk must not. This project follows those practices but does **not** claim legal compliance (CFP, LGPD).

## Decision
- Only the author can list or read a note. Owner and reception get 403, a colleague gets 404; every attempt, allowed or denied, is written to an audit log the owner can read (who, when, which patient, never the content).
- Notes are encrypted with AES-256-GCM, a fresh IV per note and **additional authenticated data binding the ciphertext to its row** (clinic, patient, author, note id): copying a ciphertext onto another row makes decryption fail. A tampered note is reported, never served.
- The key ring lives outside the database (`NOTES_ENCRYPTION_KEYS`, versioned): the highest version encrypts, older ones still decrypt.
- Notes are never edited or deleted: corrections are addenda linked to the original.

## Consequences
- A database dump alone doesn't expose any note.
- Losing the key ring makes the notes unreadable: it must be backed up separately.
- No full-text search over notes (it would require plaintext).

## Rejected alternatives
- PostgreSQL `pgcrypto`: the key would travel in SQL and show up in logs.
- Hiding notes in the UI only: the API is the boundary, not the screen.
