---
uuid: "openplanner-15-03-temporary-watcher-infrastructure"
title: "15-03: Temporary Watcher Infrastructure"
status: proposed
priority: P0
labels: ["tasks", "5sp", "watcher", "change-stream", "infrastructure"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 15-03: Temporary Watcher Infrastructure

**Epic:** 15 — Event-Driven Auth & User Lifecycle

## Description

Build the temporary watcher pattern: the client (web via Socket.IO, or HTTP) creates a short-lived subscription to observe the outcome of an event it just emitted. For Socket.IO clients, this is a room join + event listener. For HTTP, this is a change stream watcher.

## Acceptance Criteria

### Socket.IO path (primary for web clients)

- Server joins the client to a `causal/root` room when they emit a request event
- Response event is emitted back to that room by the processing system
- Client receives the response on the same socket connection
- Room is cleaned up after response or timeout
- No change stream needed — socket.io rooms ARE the temporary watcher

### HTTP path (compat)

- `createTemporaryWatcher(filter, timeoutMs)` function:
  - Opens a Mongo change stream with the given filter
  - Returns a promise/channel that resolves on first matching event
  - Auto-closes after resolution
  - Times out after `timeoutMs` (default: 30s)
  - Returns nil on timeout
- Filter options:
  - `event/type` — specific event type to watch for
  - `causal/root` — watch for events in the same causal tree
  - `session/id` — watch for events in the same session
- Watcher registry:
  - Tracks active temporary watchers
  - `cleanupWatchers()` — close all stale watchers (> 60s old)
  - Periodic sweep (every 30s) to clean up leaked watchers
- Resource safety:
  - Max 100 concurrent temporary watchers
  - If limit reached, oldest watcher is closed
  - Logging when watcher is created, resolved, timed out, or cleaned up
- The pattern:

**Socket.IO (web clients):**
  1. Client emits `user.create.request` event to `/auth` namespace
  2. Server auto-joins client to `causal/root` room
  3. Auth system processes event, emits `user.create.success` to the room
  4. Client receives response on the same socket
  5. Room is cleaned up

**HTTP (compat):**
  1. HTTP handler emits event to ledger (gets `causal/root`)
  2. HTTP handler creates temporary watcher filtered on `causal/root`
  3. HTTP handler awaits watcher resolution (with timeout)
  4. Auth system processes event, emits response event
  5. Watcher resolves with the response event
  6. HTTP handler returns response to client

## Implementation Location

Package: `packages/event-ledger/` (shared watcher infrastructure)

## Source Notes

- Task 12-03 (change stream watcher) provides the base; this adds temporary/one-shot semantics
- User's description: "the http server...will have created a temporary watcher"

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
