---
uuid: "openplanner-13-05-rest-route-refactor"
title: "13-05: REST Route Refactor to Protocol Layer"
status: done
priority: P1
labels: ["tasks", "5sp", "rest-api", "refactor", "protocols"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 13-05: REST Route Refactor to Protocol Layer

**Epic:** 13 — System Projections, Socket.IO & REST Compat Layer
**Depends on:** 13-01 (protocols), 13-04 (ownership map)

## Description

Refactor existing REST route handlers to delegate to protocol implementations instead of directly querying collections. Each route handler becomes a thin adapter that:
1. Parses the HTTP request
2. Calls the appropriate protocol method
3. Returns the result as HTTP response

## Acceptance Criteria

- Each route handler delegates to a protocol method from the relevant `packages/` system
- Route handlers contain no direct `app.mongo.*` calls
- Route handlers contain no business logic — just HTTP ↔ protocol mapping
- Existing API behavior is preserved (same endpoints, same response shapes)
- Feature flag `PROTOCOL_IMPL` (env var): `mongo` (default) | `rest` — controls which record implementation routes use
- At least 3 route files refactored as proof of pattern:
  - `events.ts` → EventAdmission protocol
  - `sessions.ts` → SessionManagement protocol
  - `tenants.ts` → a simple CRUD protocol
- Remaining routes refactored in follow-up tasks

## Source Notes

- Current route handlers: `src/routes/v1/*.ts` — all directly call `app.mongo.*`
- Protocol definitions from task 13-01
- Note: `src/` routes remain as the HTTP layer during transition, but delegate to `packages/` system modules

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
