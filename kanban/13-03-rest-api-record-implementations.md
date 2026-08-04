---
uuid: "openplanner-13-03-rest-api-record-implementations"
title: "13-03: REST API Record Implementations (Compat)"
status: done
priority: P1
labels: ["tasks", "3sp", "protocols", "rest-api", "compat"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 13-03: REST API Record Implementations (Compat)

**Epic:** 13 — System Projections, Socket.IO & REST Compat Layer
**Depends on:** 13-01 (protocols), 13-04 (ownership map)

## Description

Create record implementations of each protocol that work through the REST API. These are compatibility adapters for outside services that can't use Mongo directly.

## Acceptance Criteria

- For each protocol, a `defrecord` that:
  - Calls the REST API endpoints for writes (POST/PUT/DELETE)
  - Calls the REST API endpoints for reads (GET)
  - Uses HTTP client (fetch or node-http)
- Records take a `base-url` and optional `auth-token` as constructor args
- These records are only for external compatibility; internal systems use Mongo records
- Records live in `packages/openplanner-protocols/src/openplanner/records/rest/` (shared), or in each system's own package
- Same protocol interface as Mongo records — callers don't know which implementation they have

## Source Notes

- Existing Knoxx → OpenPlanner REST integration: `openplanner_session_store.cljs`
- REST endpoints from `src/routes/v1/index.ts`

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
