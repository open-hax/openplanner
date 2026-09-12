---
uuid: "openplanner-12-03-change-stream-watcher"
title: "12-03: Change Stream Watcher Infrastructure"
status: done
priority: P0
labels: ["tasks", "5sp", "event-ledger", "change-stream", "watcher"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 12-03: Change Stream Watcher Infrastructure

**Epic:** 12 — Event Ledger Foundation

## Description

Build the infrastructure for systems to watch the event ledger for specific event kinds via MongoDB change streams. This replaces the "trigger" concept with native Mongo `.watch()`.

## Acceptance Criteria

- `watchLedger(filter, callback)` function:
  - Opens a Mongo change stream on `event_ledger` with optional filter (by `event/type`, `session/id`, `causal/root`)
  - Calls callback on each new event matching the filter
  - Returns a watcher handle with `close()` method
- `watchOnce(filter, timeoutMs)` function:
  - Opens a temporary watcher that resolves on first matching event or times out
  - Auto-closes after resolution or timeout
  - Returns the event or `nil` on timeout
- Watcher lifecycle:
  - Watchers are registered in a registry atom
  - Registry tracks: watcher-id, filter, callback-ref, status, created-at
  - `closeWatcher(id)` removes from registry and closes the stream
  - `closeAllWatchers()` for cleanup
- Error handling:
  - Change stream errors are caught and logged
  - Watchers resume after transient errors (resume token)
  - Permanent errors close the watcher and notify callback

## Implementation Location

Package: `packages/event-ledger/`

## Source Notes

- Mongo change streams: `db.collection.watch()` — real-time event subscription
- Knoxx "trigger" concept maps to this directly

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
