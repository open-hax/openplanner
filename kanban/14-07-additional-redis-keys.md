---
uuid: "openplanner-14-07-additional-redis-keys"
title: "14-07: Additional Redis Key Patterns → Mongo"
status: done
priority: P0
labels: ["tasks", "10sp", "knoxx", "redis", "migration", "misc"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 14-07: Additional Redis Key Patterns → Mongo

**Epic:** 14 — Knoxx Redis/SQL → Mongo Migration

## Description

Migrate the remaining Redis key patterns not covered by session/run/composite stores. After the 14-04 cutover, Mongo is the default store. This task removes the last Redis usages so Redis can be fully dropped in 14-05.

## Accurate Redis Inventory (post-14-04)

| Pattern | File | Dependency | Action |
|---|---|---|---|
| `knoxx:run_events:` | `domain/action/run_state.cljs` | Soft (crash recovery) | Remove Redis write; Mongo already stores events via 14-02 |
| `knoxx:session-title:` | `infra/stores/session_titles.cljs` | Soft (falls back to atom) | Migrate cache to Mongo TTL collection |
| `temp-mem:` | `infra/temp_memory.cljs` | Soft (falls back to atom) | Migrate to Mongo TTL collection |
| `knoxx:memory:sessions:v1:` | `infra/routes/memory.cljs` | Soft (3-tier cache) | Migrate cache to Mongo TTL collection |
| `knoxx:mcp:client:` | `infra/routes/mcp.cljs` | **HARD (503)** | Migrate to Mongo collection |
| `knoxx:mcp:code:` | `infra/routes/mcp.cljs` | **HARD (503)** | Migrate to Mongo collection |
| `knoxx:mcp:token:` | `infra/routes/mcp.cljs` | **HARD (503)** | Migrate to Mongo collection |
| `knoxx:mcp:user:{id}:tokens` | `infra/routes/mcp.cljs` | **HARD (503)** | Migrate to Mongo collection (index) |
| `knoxx:chat-rate:` | `infra/agent/policy.cljs` | Soft (graceful degrade) | Migrate to Mongo TTL docs with `$inc` |
| `knoxx:session:` (auth) | `infra/auth/session.cljs` | Soft (PG is authoritative) | Remove Redis cache; PG is sole store |
| `events:control-config` | `infra/control_config.cljs` | Dead (compatibility shell) | Remove Redis calls; keep as no-op |

## Slices

### Slice 1: Cache keys → Mongo (3 SP)

Migrate soft-dependency cache keys to Mongo TTL collections.

**New collections:**
- `knoxx_session_titles` — TTL index on `expires_at`, unique index on `session_id`
- `knoxx_temp_memory` — TTL index on `expires_at`, unique index on `key`
- `knoxx_memory_sessions` — TTL index on `expires_at`, unique index on `cache_key`

**Changes:**
- `session_titles.cljs`: Replace Redis `set-json`/`get-json`/`del` with Mongo upsert/find/delete
- `temp_memory.cljs`: Replace Redis `set-json`/`get-json`/`del` with Mongo upsert/find/delete
- `memory.cljs`: Replace Redis `set-json`/`get-json` with Mongo upsert/find
- `run_state.cljs`: Remove Redis write in `append-run-event!` (Mongo already stores events via 14-02 run store)

### Slice 2: MCP OAuth → Mongo (3 SP)

Migrate MCP OAuth keys to Mongo collections.

**New collections:**
- `knoxx_mcp_clients` — unique index on `client_id`
- `knoxx_mcp_codes` — TTL index on `expires_at`, unique index on `code`
- `knoxx_mcp_tokens` — TTL index on `expires_at`, unique index on `token`, compound index on `user_id`

**Changes:**
- `routes/mcp.cljs`: Replace all Redis `set`/`get`/`del`/`sadd`/`smembers`/`srem` with Mongo operations

### Slice 3: Rate limiting + Auth session (2 SP)

**Rate limiting:**
- `policy.cljs`: Replace Redis `INCR`/`EXPIRE` with Mongo `$inc` + TTL doc upsert

**Auth session cache:**
- `auth/session.cljs`: Remove Redis cache layer; Postgres is already authoritative

### Slice 4: Dead code removal (1 SP)

- `control_config.cljs`: Remove Redis calls; `persist-event-control!` and `load-event-control` become no-ops (return control/nil)
- Remove legacy Redis store files (already dead post-cutover):
  - `stores/session_store.cljs` (Redis session store)
  - `stores/redis_session_store.cljs` (Redis run persistence)
  - `stores/composite_session_store.cljs` (Redis+OP dual store)
  - `stores/session_flush.cljs` (Redis-based stale run flushing)
  - `stores/redis_message_source.cljs` (misnamed, already reads from Mongo)

## Out of Scope

- `redis_client.cljs` removal — handled in 14-05
- `bootstrap.cljs` Redis startup — handled in 14-05

## Implementation Location

Package: `packages/agents/knoxx/backend/` (ClojureScript)

## Verification (non-negotiable)

1. `pnpm exec shadow-cljs compile test` — 0 failures, 0 errors
2. `pnpm exec shadow-cljs compile server` — 0 warnings
3. `clj-kondo --lint src test` — 0 errors
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
