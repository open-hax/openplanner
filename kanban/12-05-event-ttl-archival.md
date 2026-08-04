---
uuid: "openplanner-12-05-event-ttl-archival"
title: "12-05: Event TTL Configuration"
status: done
done_at: "2026-06-05T00:00:00Z"
priority: P0
labels: ["tasks", "3sp", "event-ledger", "ttl", "config"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 12-05: Event TTL Configuration

**Epic:** 12 — Event Ledger Foundation

## Description

Configure TTL behavior for the event ledger. Events default to 1 month TTL. Per-type overrides allow longer retention for compliance events.

## Acceptance Criteria

- Default TTL: 30 days from `event/time`
- TTL is set on insert via `expiresAt` field (handled by append primitive in 12-02)
- Configurable TTL per event type via `event_ttl_overrides` config document:
  - `user.*` events: 90 days
  - `audit.*` events: 365 days
  - `session.*` events: 7 days
- Config stored in `event_ttl_overrides` collection or config document
- Mongo TTL monitor deletes expired events (background, no custom process needed)
- Projection collections have no TTL (they persist what matters)
- Documentation note: "If you want it to last, write a projection"

## Out of Scope

- Cold storage archival (S3 export) — separate follow-up if needed
- Custom archival processes — Mongo TTL handles cleanup

## Implementation Location

Package: `packages/event-ledger/`

## Source Notes

- Receipt River design: append-only, projections derive durable state
- TTL policy from user's architecture description: "Events by default have a TTL of 1 month"

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
