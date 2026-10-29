---
uuid: "openplanner-15-01-user-lifecycle-event-types"
title: "15-01: User Lifecycle Event Type Definitions"
status: proposed
priority: P0
labels: ["tasks", "2sp", "events", "user-lifecycle", "schema"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 15-01: User Lifecycle Event Type Definitions

**Epic:** 15 — Event-Driven Auth & User Lifecycle

## Description

Define the closed vocabulary of event types for the user lifecycle. These become the first concrete event types in the ledger.

## Acceptance Criteria

Event types defined:

### User CRUD

- `user.create.request` — signup request from frontend
  - payload: `email`, `name`, `password` (plaintext — server hashes), `org_id?`, `invitation_id?`
- `user.create.success` — user created successfully
  - payload: `user_id`, `email`, `org_id`
- `user.create.failure` — creation failed
  - payload: `reason`, `error_code`, `email`

- `user.update.request` — profile update request
  - payload: `user_id`, `fields` (map of changed fields)
- `user.update.success` — update succeeded
  - payload: `user_id`, `fields`
- `user.update.failure` — update failed
  - payload: `user_id`, `reason`, `error_code`

- `user.delete.request` — account deletion request
  - payload: `user_id`, `reason?`
- `user.delete.success` — deletion succeeded
  - payload: `user_id`
- `user.delete.failure` — deletion failed
  - payload: `user_id`, `reason`, `error_code`

### Auth lifecycle

- `user.login.request` — login attempt
  - payload: `email`, `password` (plaintext), `method` (password, oauth, token)
- `user.login.success` — login succeeded
  - payload: `user_id`, `session_id`, `method`
- `user.login.failure` — login failed
  - payload: `email`, `reason`, `method`

- `user.logout.request` — logout request
  - payload: `session_id`
- `user.logout.success` — logout succeeded
  - payload: `session_id`, `user_id`
- `user.logout.failure` — logout failed
  - payload: `session_id`, `reason`

### Password management

- `user.password-change.request` — password change request
  - payload: `user_id`, `old_password`, `new_password`
- `user.password-change.success` — password changed
  - payload: `user_id`
- `user.password-change.failure` — password change failed
  - payload: `user_id`, `reason`

### Account status

- `user.status-change.request` — suspend/reactivate account
  - payload: `user_id`, `new_status`, `reason?`
- `user.status-change.success` — status changed
  - payload: `user_id`, `old_status`, `new_status`
- `user.status-change.failure` — status change failed
  - payload: `user_id`, `reason`

Each event type has a Malli/JSON schema for its payload.

Stored as `docs/architecture/event-types/user-lifecycle.md` and as Malli schemas in `packages/event-ledger/`.

## Source Notes

- User's example: `user.create.request` → `user.create.success`
- eta-mu-sol closed event vocabulary pattern (`law/event_families.clj:59`)
- Password handling: client sends plaintext, server hashes (matches existing `policy.cljs` behavior)

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
