---
uuid: "openplanner-13-04-projection-collection-ownership"
title: "13-04: Projection Collection Ownership Map"
status: done
done_at: "2026-06-05T00:00:00Z"
priority: P0
labels: ["tasks", "2sp", "projections", "architecture", "collection-map"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 13-04: Projection Collection Ownership Map

**Epic:** 13 — System Projections, Socket.IO & REST Compat Layer
**Depends on:** 13-01 (protocols must be defined first)

## Description

Define the ownership map: which system watches which event kinds and writes to which projection collection. This is the architectural contract for the event-driven system.

## Acceptance Criteria

Document produced with:

Each system is a `packages/` module. The ownership map defines which package owns which collection:

| Package | System | Watches (event kinds) | Owns (collection) |
|---------|--------|----------------------|-------------------|
| `packages/auth-system/` | Auth | `user.*.request` | `knoxx_users` |
| `packages/session-system/` | Session | `session.*` | `knoxx_sessions` |
| `packages/graph-system/` | Graph | `graph.*` | `graph_edges`, `graph_nodes`, etc. |
| `packages/translation-system/` | Translation | `translation.*` | `translation_segments`, etc. |
| `packages/label-system/` | Labels | `label.*` | `km_labels`, `graph_label_nodes` |
| `packages/cms-system/` | CMS | `document.*`, `garden.*` | `gardens`, `translation_segments` |
| `packages/audit-system/` | Audit | `*.success`, `*.failure` | `audit_log` |

Note: `audit-system` is informational in M2 — no task creates this watcher yet, just the ownership row.

Each row defines:
- Event kinds the system subscribes to
- Collection(s) the system writes to
- What happens if the system is down (event stays in ledger, retried)

Stored as `docs/architecture/projection-collection-ownership.md`.

## Source Notes

- Current collection registry: `src/lib/mongodb.ts:546`
- User's description: "Systems take actions in response to events being created"

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
