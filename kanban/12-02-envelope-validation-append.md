---
uuid: "openplanner-12-02-envelope-validation-append"
title: "12-02: Envelope Validation + Append Primitive"
status: done
priority: P0
labels: ["tasks", "5sp", "event-ledger", "validation", "append"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 12-02: Envelope Validation + Append Primitive

**Epic:** 12 — Event Ledger Foundation

## Description

Implement the append primitive that validates an incoming event against the envelope schema before inserting into the ledger. Assigns `ledger/seq` server-side.

## Acceptance Criteria

- `appendEvent(event)` function:
  - Validates required fields: `event/id`, `event/type`, `event/time`, `event/from`, `event/to`, `payload`
  - Generates `event/id` if not provided (uuid v4)
  - Sets `event/time` to now if not provided
  - Assigns `ledger/seq` from a counters collection (`_id: "event_ledger"`, `$inc: {seq: 1}` via `findOneAndUpdate` with `upsert: true`)
  - `ledger/seq` is monotonic but may have gaps on error retries — this is acceptable
  - Sets `expiresAt` to now + 30 days (or per-type override from `event_ttl_overrides` config)
  - Sets `createdAt` and `updatedAt`
  - Rejects events missing required fields with structured error
  - Returns the appended event with `ledger/seq` assigned
- Duplicate `event/id` returns existing event (idempotent append)
- Batch append `appendEvents(events)` for bulk ingestion

## Implementation Location

Package: `packages/event-ledger/`

## Source Notes

- Receipt River append design: `agile/tasks/07-01-receipt-river.md`
- Current event ingest in `src/routes/v1/events.ts:69`

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
