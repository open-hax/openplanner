---
uuid: "openplanner-15-04-signup-flow"
title: "15-04: Signup Page → Event → Watcher → Response Flow"
status: proposed
priority: P0
labels: ["tasks", "5sp", "signup", "user-lifecycle", "e2e", "event-driven"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 15-04: Signup Page → Event → Watcher → Response Flow

**Epic:** 15 — Event-Driven Auth & User Lifecycle

## Description

Implement the end-to-end signup flow using the event ledger pattern. Web clients use Socket.IO; HTTP is the compat path. This is the first complete demonstration of the new architecture.

## Acceptance Criteria

### Socket.IO path (primary)

1. Web client connects to socket.io, joins `/auth` namespace
2. Client emits: `user.create.request` with `{email, name, password}`
3. Server:
   - Validates envelope schema (middleware)
   - Appends event to ledger
   - Joins client to `req:{causal-root}` room
   - Auth watcher observes event, creates user in `knoxx_users`
   - Auth watcher emits `user.create.success` to the room
4. Client receives `user.create.success` with user data
5. On failure: client receives `user.create.failure` with reason

### HTTP path (compat)

1. `POST /auth/signup` with `{email, name, password}`
2. HTTP handler appends `user.create.request` to ledger
3. HTTP handler creates temporary change stream watcher on `causal/root`
4. Auth watcher processes, emits `user.create.success`
5. Watcher resolves, HTTP returns 201

Test cases:
- Happy path via Socket.IO: emits request, gets success event back
- Happy path via HTTP: POST, gets 201
- Duplicate email: Socket.IO gets failure event; HTTP gets 409
- Invalid input: both paths get validation error
- Auth system down: both paths timeout (Socket.IO via no response, HTTP via watcher timeout)
- Concurrent signup same email: one succeeds, one gets failure/conflict

## Implementation Location

- Socket.IO server: `packages/event-ledger/` (namespace setup)
- Auth watcher: `packages/auth-system/`
- Event ledger: `packages/event-ledger/`
- Client library: `packages/openplanner-client/`
- HTTP shell: `src/routes/v1/auth.ts` (thin compat, dies with TypeScript)

## Source Notes

- REST signup route: `src/routes/v1/` (auth routes, if exists)
- User's description: "if say a user interacts with the signup page and presses 'create user'"

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
