---
uuid: "openplanner-14-05-remove-redis-pg-dependencies"
title: "14-05: Remove Redis + PG Dependencies from Knoxx"
status: done
priority: P0
labels: ["tasks", "5sp", "knoxx", "redis", "postgres", "cleanup", "dependencies"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 14-05: Remove Redis + PG Dependencies from Knoxx

**Epic:** 14 — Knoxx Redis/SQL → Mongo Migration
**Depends on:** 14-01, 14-02, 14-03, 14-04, 14-07 (all stores must be migrated first)

## Description

After all Knoxx stores are migrated to Mongo, remove the Redis and PostgreSQL client dependencies from the Knoxx backend package.

## Acceptance Criteria

**Redis removal:**
- `redis` package removed from `knoxx/backend/package.json`
- `redis_client.cljs` deleted
- `session_store.cljs` no longer imports `redis_client`
- `redis_session_store.cljs` deleted
- `redis_message_source.cljs` deleted
- `composite_session_store.cljs` simplified to Mongo-only
- `config.cljs` removes `:redis-url` config
- Second Redis client in `infra/auth/session.cljs` — remove import and use Mongo session store instead

**PG removal:**
- `pg` package removed from `knoxx/backend/package.json`
- `pg.cljs` extern deleted
- `policy.cljs` no longer imports or references `pg`
- `policy/schema.cljs` DDL execution removed

**Verification:**
- `npm install` succeeds without redis/pg
- `clj -M:lint` passes with zero warnings
- `grep -r "redis" packages/agents/knoxx/backend/src/` returns zero hits
- `grep -r "require.*pg" packages/agents/knoxx/backend/src/` returns zero hits
- **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.

## Implementation Location

Package: `packages/knoxx-backend/` — remove deps from `package.json` and delete unused files.

## Source Notes

- Redis client: `knoxx/backend/src/cljs/knoxx/backend/infra/redis_client.cljs`
- PG extern: `knoxx/backend/src/cljs/knoxx/backend/extern/pg.cljs`
- Second Redis client: `knoxx/backend/src/cljs/knoxx/backend/infra/auth/session.cljs`
- Package deps: `knoxx/backend/package.json` lines 50, 55

## Completion Notes (2026-06-06)

Landed as three knoxx commits on `fix/frontend-es2022-lib`:
- `a0250422` Redis removal (client, redis stores, MCP 503 guard, resource index
  atom, auth/session dead plumbing, :redis-url, with-redis-nil, dep + lockfile)
- `3d0aba15` PG removal — required finishing the 14-04 dispatch first: directory/
  roles/tools slices wired to their Mongo twins at the query seam (public fn
  signatures unchanged; pool arg retained but ignored). extern/pg, policy schema
  DDL, shape/db HoneySQL builders, sql_adapter, migrate tool all deleted.
- `7d44859e` review fixes: studio routes wired to mongo-policy-studio twin
  (reads returned empty / writes silently dropped), login membership pick now
  filters to active memberships (PG SELECT parity), /api/data/pg/* returns an
  explicit 410, actor-mailbox durable persistence honestly disabled (no Mongo
  twin yet — see 14-09).

Verification: 578 tests / 0 failures, compile server 0 warnings, clj-kondo at
pre-existing baseline (5 errors: 3× private-var in model_routes_test, 2× the
intentionally-broken broken.edn fixture). Code review sub-agent: 3 majors found
and fixed (above), re-verified green.
