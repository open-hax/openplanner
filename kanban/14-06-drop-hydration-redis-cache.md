---
uuid: "openplanner-14-06-drop-hydration-redis-cache"
title: "14-06: Drop Hydration Redis Cache Layer"
status: done
priority: P2
labels: ["tasks", "2sp", "redis", "hydration", "cache", "cleanup"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 14-06: Drop Hydration Redis Cache Layer

**Epic:** 14 — Knoxx Redis/SQL → Mongo Migration

## Description

Remove the optional Redis layer from the document hydration cache. The hydration cache degrades to in-memory LRU + LMDB (both already work without Redis).

## Acceptance Criteria

- `source-hydration.ts` removes Redis layer from `createLayeredCache`
- `OPENPLANNER_HYDRATION_REDIS_URL` env var no longer checked
- `redis` dependency removed from OpenPlanner core `package.json`
- `@open-hax/openplanner-store-cache` package removes `createRedisCache` export
- Hydration cache falls back to: in-memory LRU → LMDB
- `npm test` passes
- No behavioral change for hydration consumers

## Implementation Location

`packages/stores/cache/` — remove `createRedisCache` export. Core hydration in `packages/openplanner/` or wherever the hydration module lands.

## Source Notes

- Current hydration cache: `src/lib/source-hydration.ts:41-45`
- Cache package: `packages/stores/cache/index.d.ts`
- Redis dep: `package.json` line 44

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.

## Completion Notes (2026-06-06)

- `src/lib/source-hydration.ts`: Redis layer + OPENPLANNER_HYDRATION_REDIS_URL
  removed; cache composes in-memory LRU → (optional) LMDB.
- `createRedisCache` removed from @open-hax/openplanner-store-cache and
  @open-hax/openplanner-document-hydration (CLJS adapter, boundary fn,
  shadow-cljs exports, index.d.ts, redis-specific tests); dists rebuilt.
- `redis` removed from core package.json; workspace lockfile refreshed.
- Verification: cache pkg 5 tests / document-hydration 4 tests, 0 failures;
  both `release lib` builds 0 warnings; clj-kondo 0/0; `tsc --noEmit` clean.
