---
uuid: "openplanner-15-02-auth-system-watcher"
title: "15-02: Auth System Watcher for User Events"
status: proposed
priority: P0
labels: ["tasks", "5sp", "auth", "watcher", "user-lifecycle", "event-driven"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 15-02: Auth System Watcher for User Events

**Epic:** 15 — Event-Driven Auth & User Lifecycle

## Description

Implement the auth system as a watcher that subscribes to user lifecycle events and produces effects in the `knoxx_users` projection collection.

## Acceptance Criteria

- Auth watcher subscribes to `user.*.request` events in the ledger
- On `user.create.request`:
  - Validates email uniqueness against `knoxx_users`
  - Hashes password server-side (bcrypt/argon2) — client sends plaintext `password`
  - Creates user document in `knoxx_users`
  - Emits `user.create.success` event to ledger
  - On failure: emits `user.create.failure` event with reason
- On `user.update.request`:
  - Validates user exists
  - Applies field changes
  - Emits `user.update.success` or `user.update.failure`
- On `user.delete.request`:
  - Soft-delete (set status to `deleted`)
  - Emits `user.delete.success` or `user.delete.failure`
- On `user.login.request`:
  - Validates credentials against `knoxx_users`
  - Creates login session in `auth_sessions` collection (NOT `knoxx_sessions` which is for Knoxx conversation sessions)
  - Emits `user.login.success` or `user.login.failure`
- On `user.logout.request`:
  - Invalidates session in `auth_sessions`
  - Emits `user.logout.success` or `user.logout.failure`
- On `user.password-change.request`:
  - Validates old password
  - Hashes new password
  - Updates `knoxx_users.password_hash`
  - Emits `user.password-change.success` or `user.password-change.failure`
- On `user.status-change.request`:
  - Updates `knoxx_users.status`
  - Emits `user.status-change.success` or `user.status-change.failure`
- **Idempotency**: each event handler checks `event/id` against a processed events index in `knoxx_users` (or a dedicated `auth_processed_events` collection with TTL). Duplicate event IDs are acknowledged but not reprocessed.
- Auth watcher is a long-running process (started on server boot)
- Error handling: individual event failures don't crash the watcher
- Feature flag `OPENPLANNER_AUTH_SYSTEM=event-driven` to toggle between old and new auth paths

### `auth_sessions` collection

Separate from `knoxx_sessions` (Knoxx conversation sessions). Stores login/authentication sessions:

- `session_id` (string, unique)
- `user_id` (string, indexed)
- `token_hash` (string — hashed session token)
- `org_id` (string)
- `expires_at` (Date, TTL index)
- `created_at` (Date)
- `last_seen_at` (Date)
- `ip` (string)
- `user_agent` (string)

## Implementation Location

Package: `packages/auth-system/` (ClojureScript)

## Source Notes

- User's description: "an auth system will be watching for events of that kind"
- `knoxx_users` collection: `packages/knoxx-backend/src/cljs/knoxx/backend/infra/db/policy.cljs`
- Current auth session handling: `packages/knoxx-backend/src/cljs/knoxx/backend/infra/auth/session.cljs` (uses second Redis client)
- `knoxx_sessions` is for conversation sessions only — auth sessions are a separate concern

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
