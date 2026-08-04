---
uuid: "openplanner-16-05-extract-shared-shapes"
title: "16-05: Extract Shared Shapes → packages/shapes"
status: proposed
priority: P1
labels: ["tasks", "3sp", "decomposition", "shapes", "malli", "packages"]
created_at: "2026-06-06T00:00:00Z"
category: "tasks"
---

# 16-05: Extract Shared Shapes → `packages/shapes`

**Epic:** 16 — Extraction Foundation
**Depends on:** 16-01

## Description

Move the generic, domain-agnostic shape morphisms into `packages/shapes`
(`@open-hax/shapes`). These are pure structure-only functions/schemas with no I/O and
no domain knowledge — the `shape/` layer's reusable core.

**In scope:** `shape/{number,parse,path,url,pipeline}.cljs`

**Explicitly out of scope (travel with their owning capability packages):**
- `shape/agent/*` + `shape/agent.cljs` → agent-runtime (E19)
- `shape/db/*` → policy-engine (E18)
- `shape/{session_persistence,memory_sessions}.cljs` → agent-stores (E18)
- `shape/app_shapes.cljs` → knoxx distro opinion, stays in-tree

## Acceptance Criteria

- `packages/shapes/` scaffolded from the 16-01 template (or fills the 16-01 seed shell)
- The five namespaces moved + renamed per template convention
- Every exported fn keeps its Malli boundary contract; schemas registry-keyed per the
  clojure-mu convention where applicable
- Pure-function property: package has zero npm runtime deps beyond CLJS stdlib + malli
- Tests move with the namespaces
- Package published; knoxx cutover deferred to 16-06

## Implementation Location

`packages/shapes/`

## Source Notes

- Source: `packages/agents/knoxx/backend/src/cljs/knoxx/backend/shape/`
- AGENTS.md four-layer rule: `shape/*` is structure-only morphisms, pure and
  domain-agnostic — this package is the canonical home of that layer

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent. No critical issues before done.
