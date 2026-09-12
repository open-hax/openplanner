---
uuid: "openplanner-12-04-rest-compat-adapter"
title: "12-04: REST Compatibility Adapter"
status: done
done_at: "2026-06-05T00:00:00Z"
priority: P0
labels: ["tasks", "3sp", "event-ledger", "rest-api", "compat"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 12-04: REST Compatibility Adapter

**Epic:** 12 — Event Ledger Foundation

## Description

Make the existing REST `/events` endpoint write to the new `event_ledger` collection instead of (or in addition to) the legacy `events` collection. External services continue using the REST API; internal systems use Mongo directly.

## Acceptance Criteria

- `POST /events` writes to `event_ledger`
- Feature flag `OPENPLANNER_USE_EVENT_LEDGER=true`:
  - `true` (default after M1): writes to `event_ledger` only
  - `false` (transition): writes to legacy `events` only
  - During transition, dual-write is NOT supported — pick one
- Request body mapped to envelope shape:
  - `kind` → `event/type`
  - `source` → `event/from.actor-kind`
  - `ts` → `event/time`
  - `text`, `attachments`, `extra` → `payload`
- Returns the appended event with `ledger/seq`
- Backward-compatible response shape (existing clients don't break)
- `GET /events` reads from whichever collection the flag selects (not merged — see 12-06 for merge bridge)

## Implementation Location

Package: `packages/event-ledger/` (protocol + REST adapter)

## Source Notes

- Current event route: `src/routes/v1/events.ts:69`
- Current event ingest shape: `src/lib/types.ts:15` (EventEnvelopeV1)

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
