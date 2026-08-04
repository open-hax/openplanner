---
uuid: "openplanner-14-03-knoxx-composite-store-mongo"
title: "14-03: Knoxx Composite Store → Mongo-Only"
status: done
priority: P1
labels: ["tasks", "3sp", "knoxx", "composite-store", "mongo", "migration"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 14-03: Knoxx Composite Store → Mongo-Only

**Epic:** 14 — Knoxx Redis/SQL → Mongo Migration

## Description

Replace the composite session store (Redis-primary for live, OpenPlanner for archive) with a single Mongo store. Live and archived sessions both live in `knoxx_sessions`.

## Acceptance Criteria

- Single store backing: `knoxx_sessions` collection
- Write path: always Mongo (no dual-write to Redis + OpenPlanner)
- Read path: Mongo only (no Redis-first-OpenPlanner-fallback)
- "Live" vs "archived" distinguished by `status` field:
  - `active`, `streaming` = live
  - `completed`, `failed` = archived
- TTL handles cleanup of old sessions automatically
- `recover-sessions!` on startup reads from Mongo (not Redis)
- Performance parity: Mongo reads < 50ms for session lookups
- Feature flag `OPENPLANNER_KNOXX_COMPOSITE_STORE=mongo`

## Implementation Location

Package: `packages/knoxx-backend/` (ClojureScript)

## Source Notes

- Current composite store: `knoxx/backend/src/cljs/knoxx/backend/infra/stores/composite_session_store.cljs`
- OpenPlanner session store: `knoxx/backend/src/cljs/knoxx/backend/infra/stores/openplanner_session_store.cljs`

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
