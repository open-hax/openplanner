---
uuid: "openplanner-13-02-mongo-change-stream-records"
title: "13-02: Mongo Change Stream Record Implementations"
status: done
priority: P0
labels: ["tasks", "5sp", "protocols", "mongo", "change-stream"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 13-02: Mongo Change Stream Record Implementations

**Epic:** 13 — System Projections, Socket.IO & REST Compat Layer
**Depends on:** 13-01 (protocols), 13-04 (ownership map — records need to know their collection)

## Description

Create record implementations of each protocol that work through Mongo change streams. This is the primary (non-compat) path for internal systems.

## Acceptance Criteria

- For each protocol (EventAdmission, SessionManagement, DocumentStorage, etc.):
  - A `defrecord` implementing the protocol
  - `append-event!` writes to `event_ledger` and returns the ledger entry
  - `watch-events` opens a Mongo change stream on `event_ledger` with filter
  - Read operations query the system's own projection collection
  - Write operations emit events to the ledger (system writes to its collection as a side effect of the event)
- Records take a `db` (MongoDB connection) as constructor arg
- All operations are async (return channels or promises)
- Records live in `packages/openplanner-protocols/src/openplanner/records/mongo/` (shared), or in each system's own package
- Unit test for each protocol method with mock Mongo connection

## Source Notes

- Cephalon `MongoDBMemoryStore` as existing Mongo record pattern (`mongodb_store.cljs:66`)
- Change stream watcher from task 12-03

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
