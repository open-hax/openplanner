---
uuid: "openplanner-typescript-to-cljs-epic"
title: "Epic: retire TypeScript across the OpenPlanner monorepo"
status: incoming
priority: P0
labels: ["epic", "cljs", "typescript-retirement", "monorepo", "roadmap", "architecture"]
created_at: "2026-06-01T18:00:00Z"
source: "user-intent:2026-06-01-entire-monorepo-typescript-to-cljs-roadmap"
points: 21
category: "epics"
---
# Epic: retire TypeScript across the OpenPlanner monorepo

## Intent

Retire TypeScript as source code across the active OpenPlanner monorepo and move implementation authority to ClojureScript.

Knoxx backend CLJS is the current gold-standard backend/runtime pattern. New migration work should follow its ESM export, Fastify lifecycle, boundary-helper, async, and test patterns where applicable.

## Scope

Detailed roadmap:

- `docs/architecture/typescript-to-cljs-monorepo-roadmap.md`

Full active file inventory:

- `docs/architecture/typescript-to-cljs-file-inventory.md`

Inventory summary from the active worktree scan:

| Kind | Count |
| --- | ---: |
| source `.ts` | 448 |
| frontend `.tsx` | 132 |
| tests/specs | 149 |
| tooling/config `.ts` | 12 |
| declarations `.d.ts` | 15 |
| **Total** | **756** |

The inventory includes `archive/` and `pseudo/`, but excludes generated/vendor directories and nested `.worktrees/` checkouts.

## Non-negotiables

- Do not add new TypeScript business logic.
- Do not treat TypeScript compatibility shims as authoritative implementation.
- Every temporary shim must have an owner and deletion condition.
- Do not put new implementation under `archive/embedding/src/`.
- OpenPlanner/Mongo remains canonical graph truth.
- Redis is runtime/session/process coordination, not durable graph truth.
- Archive code must be explicitly deleted, moved out of active inventory, or ported; it cannot be silently ignored.

## Blocking order

```text
T0 freeze/standard
  -> T1 shared leaves
  -> T2 root OpenPlanner CLJS runtime/API
     -> T3 graph tranche
     -> T5 pseudo/client tools
     -> T6 agent tranche
  -> T8 archive disposition
  -> T9 final sweep
```

Parallel lanes after T1:

```text
T1 -> T4 signals -> T6 Cephalon
T1 -> T7 shared UI -> T6 Knoxx frontend
T1 -> T3 ACO leaf -> T3 Graph Weaver/Myrmex
```

## Task groups

1. **T0 — Freeze, accounting, and CLJS package standard**
   - Add no-new-TS gate and migration allowlist.
   - Standardize CLJS package layout and Node import smoke checks.

2. **T1 — Leaf shared packages and declaration stubs**
   - Retire low-count shared packages first: logger, test-utils, store-cache, document-hydration, translation-core, graph-claim-core, client declarations, signal contract declarations.

3. **T2 — Root OpenPlanner API/runtime CLJS port**
   - Port canonical Fastify/Mongo/vector/graph/translation/tenant/event routes before downstream clients and workbenches depend on unstable APIs.

4. **T3 — Graph package tranche**
   - `graph-weaver-aco` before `graph-weaver`/`myrmex`.
   - `graph-weaver` becomes importable CLJS Fastify plugin with standalone wrapper.
   - UI/view packages follow the API/runtime shape.

5. **T4 — Signals/events tranche**
   - `event` and `sintel` before Cephalon runtime migration.

6. **T5 — Pseudo/service adapters and client tools**
   - OAuth/Janus leaves first, then clients, then workbench.
   - Repoint away from archive persistence where canonical OpenPlanner CLJS APIs exist.

7. **T6 — Agent package tranche**
   - Knoxx package/frontend and Cephalon TS after shared contracts, signals, clients, and UI strategy are stable.

8. **T7 — UI/component leaf packages**
   - Port or replace shared UI components before high-volume TSX frontend migration.

9. **T8 — Archive disposition and legacy dependency breakage**
   - Delete, quarantine, or port archive TS with explicit decision records.

10. **T9 — Tooling/config/test final sweep**
    - Remove `.config.ts`, `.d.ts`, tsconfig/tooling remnants, stale TypeScript dependencies, and allowlist entries.

## Acceptance criteria

- Active inventory count is zero for `.ts`, `.tsx`, `.cts`, `.mts`, and `.d.ts` source files outside generated build output.
- OpenPlanner root service builds and runs from CLJS.
- Graph Weaver imported and standalone modes build and run from the same CLJS runtime/plugin.
- Knoxx frontend and active agent surfaces no longer contain TypeScript/TSX source.
- Pseudo/archive TypeScript has explicit deletion/quarantine/port disposition.
- CI rejects unowned new TypeScript files.

## First executable slice

Start with T0 via `openplanner-no-new-typescript-inventory-gate`:

1. Add an inventory script that emits the same grouping as `docs/architecture/typescript-to-cljs-file-inventory.md`.
2. Add a no-new-TypeScript allowlist file keyed by this epic/task group.
3. Wire CI so new TS files fail unless the allowlist and roadmap are updated.
