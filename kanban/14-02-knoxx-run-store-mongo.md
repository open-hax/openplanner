---
uuid: "openplanner-14-02-knoxx-run-store-mongo"
title: "14-02: Knoxx Run Store + Run Events → Mongo Collection"
status: done
priority: P0
labels: ["tasks", "5sp", "knoxx", "runs", "mongo", "migration"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 14-02: Knoxx Run Store → Mongo Collection

**Epic:** 14 — Knoxx Redis/SQL → Mongo Migration

## Description

Replace the Redis-backed run store (`knoxx:run:{id}` keys) and run event log (`knoxx:run_events:{id}` lists) with a Mongo collection. Runs are sub-entities of sessions with shorter TTL.

## Acceptance Criteria

- New collection `knoxx_runs` with TTL index
- Document shape:
  - `run_id` (string, unique index)
  - `session_id` (string, indexed, references `knoxx_sessions`)
  - `status` (string: running, completed, failed)
  - `has_active_stream` (boolean)
  - `messages` (array)
  - `tool_calls` (array)
  - `trace_blocks` (array — reasoning trace)
  - `model` (string)
  - `token_usage` (map)
  - `answer` (string)
  - `error` (string)
  - `run_events` (array — replaces Redis list `knoxx:run_events:{id}`, max 1000 events per run)
  - `expiresAt` (Date, TTL index, 2h default)
  - `createdAt`, `updatedAt` (Date)
- Indexes: `run_id` (unique), `session_id`, `status`
- `put-run!`, `get-run`, `patch-run!`, `list-active-runs`, `complete-run!`, `delete-run!`
- `append-run-event!` — appends to `run_events` array (replaces Redis lpush)
- TTL: 2 hours (vs 1 hour for sessions)
- Feature flag `OPENPLANNER_KNOXX_RUN_STORE=mongo`
- Data migration: script to import active runs from Redis (one-time, idempotent)

## Implementation Location

Package: `packages/knoxx-backend/` (ClojureScript)

## Source Notes

- Current Redis run store: `knoxx/backend/src/cljs/knoxx/backend/infra/stores/redis_session_store.cljs`
- Redis keys: `knoxx:run:{run-id}` (2h TTL), `knoxx:session_runs:{session-id}` (set)

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
