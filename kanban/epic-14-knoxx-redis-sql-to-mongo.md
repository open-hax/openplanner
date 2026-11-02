---
uuid: "openplanner-knoxx-redis-sql-to-mongo"
title: "Epic: Knoxx Redis/SQL → Mongo Migration"
status: done
priority: P1
labels: ["epic", "knoxx", "redis", "postgres", "mongo", "migration"]
created_at: "2026-06-05T00:00:00Z"
category: "epic"
---

# Epic: Knoxx Redis/SQL → Mongo Migration

## Objective

Move all Knoxx state from Redis and PostgreSQL into MongoDB. Knoxx currently uses Redis for live session/run state and PostgreSQL for policy/auth (orgs, users, memberships, roles, invites, audit). All of this becomes Mongo collections that systems own as projections of the event ledger.

## Key Design Decisions

- Redis session store → Mongo collection with TTL index (replaces `knoxx:session:{id}` keys)
- Redis run store → Mongo collection with TTL index (replaces `knoxx:run:{id}` keys)
- Redis composite store → single Mongo store with TTL (replaces Redis-primary + OpenPlanner archive dual-write)
- PostgreSQL policy DB → Mongo collections: `knoxx_orgs`, `knoxx_users`, `knoxx_memberships`, `knoxx_roles`, `knoxx_invites`, `knoxx_audit_log`, `knoxx_config`
- Each new Mongo collection is a projection watched by its owning system
- Redis dependency removed from Knoxx backend entirely
- PostgreSQL dependency removed from Knoxx backend entirely
- Hydration cache Redis layer dropped (in-memory + LMDB sufficient)
- **All new code lives in `packages/knoxx-backend/` (ClojureScript). No new TypeScript.**

## Dependencies

- Epic 12 (event ledger foundation)
- Epic 13 (projection infrastructure)

## Verification Gate (non-negotiable)

Every task in this epic **must** pass all of the following before marking done:

1. **Automated checks:**
```bash
npx shadow-cljs compile test   # 0 failures, 0 errors
npx shadow-cljs compile lib    # 0 warnings
npx clj-kondo --lint src test  # 0 errors, 0 warnings
```

2. **Code review:** Dispatch a code review sub-agent (via `task` tool) to review all changed files. The task cannot be marked done until the reviewer returns with no critical issues.

No exceptions. If a warning exists, fix it or record it explicitly with the owning file.

## Definition of Done

- Knoxx session state lives in Mongo, not Redis
- Knoxx run state lives in Mongo, not Redis
- Knoxx policy/auth data lives in Mongo, not PostgreSQL
- Redis client removed from Knoxx backend dependencies
- PG client removed from Knoxx backend dependencies
- All existing Knoxx functionality works against Mongo stores
- Composite store reads from Mongo only

## Tasks

| Task | Points | Depends On | Status |
|------|--------|-----------|--------|
| 14-01: Knoxx session store → Mongo collection | 8 | — | Done |
| 14-02: Knoxx run store + run events → Mongo | 5 | — | Done |
| 14-03: Knoxx composite store → Mongo-only | 3 | 14-01, 14-02 | Done |
| 14-04: Policy DB tables (19) → Mongo collections | 8 | — | Done |
| 14-07: Additional Redis key patterns → Mongo | 10 | — | Done |
| 14-05: Remove Redis + PG dependencies | 5 | 14-01, 14-02, 14-03, 14-04, 14-07 | Done |
| 14-06: Drop hydration Redis cache layer | 2 | 14-05 | Done |
| 14-08: System instance orphan reclaim | 2 | — | Done |

**Total: 43 points** (was 36 — 14-07 re-scoped 5→10, 14-08 added mid-epic)

## Completion Notes (2026-06-06)

- Epic complete: `redis` and `pg` removed from `knoxx/backend/package.json`; zero
  redis/pg/honeysql references in `backend/src/cljs/` (historical "replaces Redis
  X keys" docstrings in the mongo twins excepted).
- 14-05 turned out to include finishing 14-04's dispatch: the directory
  (orgs/users/memberships), roles, and tools slices had Mongo twins but were
  never wired — policy.cljs still ran HoneySQL against PG for request-context
  resolution, user/org/role CRUD, and bootstrap. All slices now dispatch to
  twins; `OPENPLANNER_KNOXX_POLICY_STORE` flag deleted.
- `migrate_pg_to_mongo.cljs` (one-shot cutover tool, all 19 tables) was deleted
  with PG; recoverable at knoxx commit `3d0aba15^` if a pre-cutover PG instance
  still needs migrating.
- Pre-cutover PG auth sessions are invalidated (users re-login) — accepted.
- Discovered gap: `actor_mailbox_routes`/`actor_mailbox_entries` were never in
  the 19-table inventory and have no Mongo twin. Durable mailbox persistence is
  now honestly disabled (entries flow live, `:mailbox/durable? false`).
  Follow-up: **14-09** (proposed, 2sp).
