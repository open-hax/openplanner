---
uuid: "openplanner-15-05-login-flow"
title: "15-05: Login Flow via Same Event Pattern"
status: proposed
priority: P1
labels: ["tasks", "3sp", "login", "user-lifecycle", "event-driven"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 15-05: Login Flow via Same Event Pattern

**Epic:** 15 — Event-Driven Auth & User Lifecycle

## Description

Implement the login flow using the same event-driven pattern as signup. Validates the pattern is reusable. Web clients use Socket.IO; HTTP is the compat path.

## Acceptance Criteria

### Socket.IO path (primary)

1. Web client connects to `/auth` namespace
2. Client emits: `user.login.request` with `{email, password, method}`
3. Server validates, appends to ledger, joins client to `req:{causal-root}` room
4. Auth watcher validates credentials, creates session in `auth_sessions` (NOT `knoxx_sessions`)
5. Auth watcher emits `user.login.success` to the room with `{session_id, token}`
6. Client receives success event with session token
7. On failure: client receives `user.login.failure` with reason

### HTTP path (compat)

1. `POST /auth/login` with `{email, password}`
2. HTTP handler appends `user.login.request` to ledger
3. Creates temporary watcher, awaits resolution
4. Auth watcher processes, emits `user.login.success`
5. HTTP returns 200 with session token

Test cases:
- Happy path via Socket.IO: emits request, gets success event with token
- Happy path via HTTP: POST, gets 200 with token
- Wrong password: both paths get failure/unauthorized
- Nonexistent user: both paths get failure/unauthorized
- Suspended account: both paths get failure/forbidden
- Session creation failure: both paths get error

## Dependencies

- 14-01: Knoxx session store (for `auth_sessions` collection pattern)
- 15-02: Auth system watcher (produces the login events)

## Implementation Location

Same as 15-04: Socket.IO primary path via `packages/event-ledger/` + `packages/auth-system/`, HTTP compat shell in `src/`.

## Source Notes

- Pattern identical to task 15-04, different event types
- Validates the "every action creates an event" principle
- Current login: `packages/knoxx-backend/src/cljs/knoxx/backend/infra/auth/session.cljs`

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
