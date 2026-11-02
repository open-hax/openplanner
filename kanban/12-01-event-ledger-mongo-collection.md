---
uuid: "openplanner-12-01-event-ledger-mongo-collection"
title: "12-01: Event Ledger Mongo Collection + Schema"
status: done
priority: P0
labels: ["tasks", "3sp", "event-ledger", "mongo", "schema"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 12-01: Event Ledger Mongo Collection + Schema

**Epic:** 12 — Event Ledger Foundation

## Description

Create the `event_ledger` Mongo collection with the canonical envelope schema, TTL index, and unique index on `event/id`.

## Acceptance Criteria

- `event_ledger` collection created via migration
- Document shape:
  - `event/id` (string, uuid, unique index)
  - `event/type` (keyword/string, indexed)
  - `event/time` (Date, indexed)
  - `event/from` (map: actor-id, actor-kind, actor-node)
  - `event/to` (map: actor-id, actor-kind, actor-node)
  - `causal/root` (uuid, indexed)
  - `causal/parent` (uuid, nullable)
  - `session/id` (uuid, indexed)
  - `turn/id` (uuid)
  - `delivery/mode` (string: tell, ask, stream, ack-required)
  - `delivery/id` (uuid, nullable)
  - `payload` (mixed, indexed on key fields per event type)
  - `ledger/seq` (number, monotonic, indexed)
  - `contracts` (array of keywords, nullable)
  - `expectations` (map, nullable)
  - `expiresAt` (Date, TTL index, 30-day default)
  - `createdAt`, `updatedAt` (Date)
- TTL index on `expiresAt` with 30-day default
- Unique index on `event/id`
- Compound index on `[event/type, event/time]`
- Index on `causal/root`
- Index on `session/id`

## Implementation Location

New package: `packages/event-ledger/` (ClojureScript)

## Source Notes

- Current `EventDocument` shape in `src/lib/mongodb.ts:204` — extends with causal fields
- Envelope schema from `eta-mu-sol/law/envelope.clj:37`

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
