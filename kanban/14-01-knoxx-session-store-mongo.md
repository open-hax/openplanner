---
uuid: "openplanner-14-01-knoxx-session-store-mongo"
title: "14-01: Knoxx Session Store → Mongo Collection"
status: done
priority: P0
labels: ["tasks", "8sp", "knoxx", "session", "mongo", "migration"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 14-01: Knoxx Session Store → Mongo Collection

**Epic:** 14 — Knoxx Redis/SQL → Mongo Migration

## Description

Replace the Redis-backed session store (`knoxx:session:{id}` keys) with a Mongo collection. Sessions are live state with TTL — Mongo TTL index replaces Redis expiry.

## Acceptance Criteria

- New collection `knoxx_sessions` with TTL index
- Document shape (all fields from `session_store.cljs:16-36`):
  - `session_id` (string, unique index)
  - `conversation_id` (string, indexed, unique — replaces `knoxx:conversation_to_session` reverse lookup)
  - `user_id` (string, indexed)
  - `org_id` (string, indexed)
  - `run_id` (string — active run reference)
  - `model` (string)
  - `mode` (string)
  - `thinking_level` (string)
  - `status` (string: `running`, `completed`, `failed`, `waiting_input` — matches code, not task defaults)
  - `messages` (array of message maps)
  - `last_token_count` (number)
  - `has_active_stream` (boolean)
  - `pending_tool_calls` (array)
  - `membership_id` (string)
  - `permissions` (array)
  - `tool_policies` (map)
  - `answer` (string — final answer text)
  - `error` (string — error text if failed)
  - `ttl_seconds` (number, default 3600; sticky sessions: 86400)
  - `expiresAt` (Date, TTL index)
  - `createdAt`, `updatedAt` (Date)
- Indexes: `session_id` (unique), `conversation_id` (unique), `user_id`, `org_id`, `status`
- `put-session!`, `get-session`, `update-session!`, `remove-session!` operations
- `recover-sessions!` for startup recovery (reads `status: running` sessions from Mongo)
- `mark-session-streaming!`, `complete-session!` lifecycle ops
- In-memory cache layer preserved (reads check cache first)
- Feature flag `OPENPLANNER_KNOXX_SESSION_STORE=mongo` to toggle
- Data migration: script to import active sessions from Redis before cutover (one-time, idempotent)

## Implementation Location

Package: `packages/knoxx-backend/` (ClojureScript)

## Source Notes

- Current Redis session store: `knoxx/backend/src/cljs/knoxx/backend/infra/stores/session_store.cljs`
- Redis keys: `knoxx:session:{session-id}`, `knoxx:conversation_to_session:{conversation-id}`, `knoxx:active_sessions`

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
