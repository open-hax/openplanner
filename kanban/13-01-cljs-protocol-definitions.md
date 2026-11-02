---
uuid: "openplanner-13-01-cljs-protocol-definitions"
title: "13-01: CLJS Protocol Definitions for System Domains"
status: done
done_at: "2026-06-05T00:00:00Z"
priority: P0
labels: ["tasks", "5sp", "protocols", "cljs", "architecture"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 13-01: CLJS Protocol Definitions for System Domains

**Epic:** 13 — System Projections & REST Compat Layer

## Description

Define CLJS protocols that describe how clients interact with each system domain. These protocols are the abstraction layer — implementations can back onto Mongo change streams, Socket.IO, or REST. Web clients connect via Socket.IO and speak the same protocol as server-side systems.

## Acceptance Criteria

Protocols defined for:

- **EventAdmission** — `append-event!`, `query-events`, `watch-events`
- **SessionManagement** — `create-session`, `get-session`, `update-session`, `close-session`
- **DocumentStorage** — `store-document`, `get-document`, `query-documents`, `archive-document`
- **GraphOperations** — `add-node`, `add-edge`, `query-neighbors`, `traverse`
- **TranslationManagement** — `create-translation`, `label-translation`, `batch-translate`
- **LabelManagement** — `create-label`, `apply-label`, `query-by-label`
- **UserManagement** — `create-user`, `authenticate`, `get-user`, `update-user`
- **RealtimeSubscription** — `subscribe`, `unsubscribe`, `emit-to-room` (Socket.IO specific)

Each protocol uses the event ledger envelope as its message shape (not raw DB operations).

Three record implementations exist per protocol: `MongoChangeStreamRecord` (server-to-server), `SocketIoRecord` (web clients), `RESTApiRecord` (external compat). Callers don't know which implementation they have.

All protocols live in a shared package: `packages/openplanner-protocols/` (ClojureScript).

Each system that implements these protocols lives in its own package (e.g., `packages/auth-system/`, `packages/session-system/`, etc.).

## Source Notes

- eta-mu-sol `ActorLifecycle` protocol as reference pattern (`infra/actor.clj:29`)
- Current REST endpoints as the behavioral reference for each domain

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
