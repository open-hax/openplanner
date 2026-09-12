---
uuid: "openplanner-12-06-legacy-events-bridge"
title: "12-06: Legacy Events Collection Bridge"
status: done
done_at: "2026-06-05T00:00:00Z"
priority: P0
labels: ["tasks", "3sp", "event-ledger", "legacy", "migration"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 12-06: Legacy Events Collection Bridge

**Epic:** 12 — Event Ledger Foundation
**Depends on:** 12-04 (REST adapter must be writing to ledger first)

## Description

Ensure the existing `events` collection remains readable during the transition period. Provide a merge-read bridge that can read from both collections.

## Acceptance Criteria

- Legacy `events` collection remains untouched (no schema changes)
- `GET /events` merges results from `event_ledger` and legacy `events`:
  - Deduplicate by `event/id` (ledger events take precedence)
  - Sort merged results by timestamp
  - Pagination: fetch N from each collection, merge-sort in memory, return page. Cursor-based pagination using timestamp + event/id as cursor. No cross-collection cursor.
- `GET /events/:id` checks `event_ledger` first, falls back to legacy
- Feature flag controls whether merge bridge is active:
  - `OPENPLANNER_EVENT_LEDGER_BRIDGE=true` — merge reads from both
  - `false` — read from ledger only (after legacy is fully sunset)
- Migration script to backfill `event_ledger` from legacy `events` (optional, one-time, idempotent)
- Deprecation timeline documented: legacy collection sunset after all systems project from ledger

## Implementation Location

Package: `packages/event-ledger/`

## Source Notes

- Current `events` collection shape: `src/lib/mongodb.ts:204`
- Existing migration jobs pattern: `src/lib/migration.ts`

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
