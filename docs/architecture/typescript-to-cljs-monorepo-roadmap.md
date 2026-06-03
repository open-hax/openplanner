# OpenPlanner TypeScript → ClojureScript Monorepo Roadmap

Date: 2026-06-01
Status: planning
Epic card: `kanban/openplanner-typescript-to-cljs-epic.md`
Inventory: `docs/architecture/typescript-to-cljs-file-inventory.md`

## Scope

This roadmap covers the active OpenPlanner worktree under `orgs/open-hax/openplanner` and every source TypeScript/TSX declaration/config/test file found outside generated/vendor directories.

Exclusions from the active inventory:

- `node_modules/`
- `dist/`, `build/`, `target/`, `.shadow-cljs/`, `.next/`, `coverage/`, `tmp/`, `vendor/`
- nested `.worktrees/` checkouts, because they are separate worktree state rather than active monorepo source

`archive/` and `pseudo/` are included. Archive code must be either deleted/retired or explicitly ported; it is not ignored.

## Inventory summary

Active TypeScript-family files found: **756**.

| Kind | Count |
| --- | ---: |
| source `.ts` | 448 |
| frontend `.tsx` | 132 |
| tests/specs | 149 |
| tooling/config `.ts` | 12 |
| declarations `.d.ts` | 15 |

## Package inventory

| TS files | Package/root | Package name | Shape | Workspace deps |
| ---: | --- | --- | --- | --- |
| 213 | `packages/agents/knoxx/frontend` | `@open-hax/knoxx-frontend` | src:57, tsx:101, test:49, cfg:5, dts:1 | @open-hax/garden-publication-components |
| 104 | `packages/agents/cephalon/packages/cephalon-ts` | `@promethean-os/cephalon-ts` | src:79, test:21, cfg:3, dts:1 | @promethean-os/event, @promethean-os/openplanner-cljs-client, @open-hax/sintel |
| 104 | `pseudo/clients` | `@open-hax/cli-client` | src:80, test:23, dts:1 | @promethean-os/logger, @promethean-os/ollama-queue, @promethean-os/opencode-interface-plugin, @promethean-os/persistence |
| 68 | `.` | `@open-hax/openplanner` | src:54, test:12, dts:2 | @open-hax/garden-publication-components, @open-hax/openplanner-document-hydration, @open-hax/openplanner-graph-claim-core, @open-hax/openplanner-store-cache, @open-hax/openplanner-translation-core |
| 51 | `archive/persistence` | `@promethean-os/persistence` | src:45, test:6 | @promethean-os/embedding, @promethean-os/logger |
| 32 | `pseudo/workbench` | `@promethean-os/opencode-unified` | src:1, test:30, cfg:1 | @promethean-os/openplanner-cljs-client, @promethean-os/opencode-cljs-client, @promethean-os/openplanner-cljs-client |
| 30 | `packages/signals/sintel` | `@open-hax/sintel` | src:29, test:1 | @open-hax/signal-contracts, @open-hax/signal-radar-core |
| 17 | `pseudo/janus` | `@promethean-os/janus` | src:14, test:3 | @workspace/mcp-oauth |
| 15 | `packages/agents/cephalon/packages/cephalon-ts/src/ui` | `cephalon-ui` | src:2, tsx:12, cfg:1 | — |
| 15 | `packages/agents/knoxx` | `@open-hax/knoxx` | src:3, tsx:12 | — |
| 15 | `packages/graph/graph-weaver` | `@workspace/graph-weaver` | src:15 | @workspace/graph-weaver-aco |
| 12 | `archive/reconstituter` | `@promethean-os/reconstituter` | src:7, test:4, cfg:1 | @promethean-os/opencode-cljs-client, @promethean-os/openplanner-cljs-client |
| 11 | `archive/semantic-graph-builder` | `@workspace/semantic-graph-builder` | src:10, dts:1 | — |
| 11 | `packages/gardens/publication-components` | `@open-hax/garden-publication-components` | src:2, tsx:7, cfg:1, dts:1 | — |
| 10 | `packages/graph/myrmex` | `@workspace/myrmex` | src:10 | @workspace/graph-weaver-aco |
| 10 | `packages/graph/webgl-graph-view` | `@octave-commons/webgl-graph-view` | src:10 | — |
| 9 | `packages/graph/graph-weaver-aco` | `@workspace/graph-weaver-aco` | src:9 | — |
| 7 | `packages/signals/event` | `@promethean-os/event` | src:7 | @promethean-os/test-utils |
| 6 | `packages/graph/eros-eris-field` | `@workspace/eros-eris-field` | src:6 | — |
| 3 | `pseudo/aether` | `@workspace/aether` | src:3 | — |
| 1 | `archive/embedding` | `@promethean-os/embedding` | src:1 | — |
| 1 | `packages/clients/opencode-cljs-client` | `@promethean-os/opencode-cljs-client` | dts:1 | — |
| 1 | `packages/clients/openplanner-cljs-client` | `@promethean-os/openplanner-cljs-client` | dts:1 | — |
| 1 | `packages/graph/eros-eris-field-app` | `@workspace/eros-eris-field-app` | src:1 | @workspace/eros-eris-field |
| 1 | `packages/graph/graph-claim-core` | `@open-hax/openplanner-graph-claim-core` | dts:1 | — |
| 1 | `packages/signals/signal-contracts` | `@open-hax/signal-contracts` | dts:1 | — |
| 1 | `packages/signals/signal-radar-core` | `@open-hax/signal-radar-core` | dts:1 | — |
| 1 | `packages/stores/cache` | `@open-hax/openplanner-store-cache` | dts:1 | — |
| 1 | `packages/stores/document-hydration` | `@open-hax/openplanner-document-hydration` | dts:1 | @open-hax/openplanner-store-cache |
| 1 | `packages/translations/translation-core` | `@open-hax/openplanner-translation-core` | dts:1 | — |
| 1 | `packages/utils/logger` | `@promethean-os/logger` | src:1 | — |
| 1 | `packages/utils/test-utils` | `@promethean-os/test-utils` | src:1 | — |
| 1 | `pseudo/mcp-oauth` | `@workspace/mcp-oauth` | src:1 | — |

## Dependency-ordered task groups

The order below is a blocking order, not a promise that all work is strictly serial. Work in the same level can run in parallel after its blockers are green.

### T0 — Freeze, accounting, and CLJS package standard

**Blocks:** every other task.

**Goal:** make TypeScript retirement enforceable before implementation begins.

**Work:**

- Keep this inventory current in CI.
- Add a no-new-TypeScript gate with explicit allowlist for files still owned by an open migration task.
- Standardize CLJS package skeletons: `shadow-cljs.edn`, `deps.edn`, `src/cljs`, `test/cljs`, ESM exports, Node import smoke checks.
- Document compatibility shim policy: no business logic in TypeScript shims, and every shim has a deletion condition.

**Exit:** CI can report remaining TS files by task group and fail on unowned new TS.

### T1 — Leaf shared packages and generated declaration stubs

**Blocks:** root OpenPlanner app, agents, pseudo clients, and downstream graph/signal consumers.

**Packages/files:**

- `packages/utils/logger` (1)
- `packages/utils/test-utils` (1)
- `packages/stores/cache` (1)
- `packages/stores/document-hydration` (1)
- `packages/translations/translation-core` (1)
- `packages/graph/graph-claim-core` (1)
- `packages/clients/opencode-cljs-client` (1 declaration)
- `packages/clients/openplanner-cljs-client` (1 declaration)
- `packages/signals/signal-contracts` (1 declaration)
- `packages/signals/signal-radar-core` (1 declaration)

**Goal:** remove low-count dependency leaves and replace TS declaration-only facades with CLJS-authored or generated package surfaces.

**Exit:** dependent packages can import CLJS/ESM outputs without TypeScript type shims as source authority.

### T2 — Root OpenPlanner API/runtime CLJS port

**Blocks:** Graph Weaver imported mode, CLI/client parity, Cephalon runtime, workbench, and final archive retirement.

**Files:** `src/**/*.ts` plus root `tests/**/*.ts` (**68 files**).

**Goal:** port canonical OpenPlanner HTTP, Mongo, vector, graph, translation, tenant, label, event, and health paths to CLJS while preserving current runtime behavior.

**Subtasks:**

1. CLJS Fastify app skeleton and route registration parity.
2. Mongo/vector/TTL/label-retention data layer port.
3. Graph/export/layout routes port; define cursor/pagination contract required by Graph Weaver.
4. Translation, documents, events, lakes, sessions, and tenant routes port.
5. Test harness migration from TS tests to CLJS/node-test.

**Exit:** root OpenPlanner service starts from CLJS, health/routes pass, and generated TS output is absent from source.

### T3 — Graph package tranche

**Blocks:** graph-memory workbench truth, Myrmex orchestration, graph UI retirement, P1B/P2 graph roadmap cleanup.

**Order inside group:**

1. `packages/graph/graph-weaver-aco` (9) — leaf ACO engine.
2. `packages/graph/graph-weaver` (15) — Fastify plugin/importable runtime; depends on ACO and root graph export cursor contract.
3. `packages/graph/myrmex` (10) — orchestrator/crawler; depends on ACO and canonical OpenPlanner writes.
4. `packages/graph/webgl-graph-view` (10) — front-end/view layer; depends on Graph Weaver API shape.
5. `packages/graph/eros-eris-field` (6) and `packages/graph/eros-eris-field-app` (1) — field library then app.

**Exit:** Graph Weaver and graph-adjacent packages build from CLJS, standalone/imported modes use the same runtime, and Graph Weaver no longer treats capped exports as full graph truth.

### T4 — Signals/events tranche

**Blocks:** Cephalon TS runtime and any signal-agent consumers.

**Order inside group:**

1. `packages/signals/event` (7) — event contract/runtime leaf.
2. `packages/signals/sintel` (30) — discovery/integration/memory signal runtime, after signal contracts/radar core from T1.

**Exit:** signal packages expose CLJS/ESM APIs and their tests are CLJS-native.

### T5 — Pseudo/service adapters and client tools

**Blocks:** workbench, Janus flows, and any legacy CLIs that currently route through TS persistence/client packages.

**Order inside group:**

1. `pseudo/mcp-oauth` (1) — leaf for Janus.
2. `pseudo/janus` (17) — depends on `mcp-oauth`.
3. `pseudo/aether` (3) — independent small pseudo package.
4. `pseudo/clients` (104) — depends on logger and legacy persistence decision; should be repointed to canonical OpenPlanner CLJS clients rather than archive persistence if possible.
5. `pseudo/workbench` (32) — depends on CLJS clients.

**Exit:** pseudo packages either build from CLJS or have been explicitly deleted/archived as non-product experiments.

### T6 — Agent package tranche

**Blocks:** final TS removal because this is the largest active TS/TSX surface.

**Order inside group:**

1. `packages/agents/knoxx` (15) — package-level pseudo/shell TSX cleanup; backend is already CLJS and remains the reference implementation.
2. `packages/agents/knoxx/frontend` (213) — React/TSX frontend port to CLJS UI stack, after shared UI/component strategy is chosen.
3. `packages/agents/cephalon/packages/cephalon-ts` (104) — migrate or retire after signals, OpenPlanner clients, and graph APIs stabilize.
4. `packages/agents/cephalon/packages/cephalon-ts/src/ui` (15) — UI slice after Cephalon runtime decision.

**Exit:** active agent packages have no TS/TSX source. Knoxx backend CLJS patterns remain canonical for backend/runtime code.

### T7 — UI/component leaf packages

**Blocks:** Knoxx frontend migration if reused as shared UI primitives.

**Packages:**

- `packages/gardens/publication-components` (11)

**Goal:** port shared UI components before high-volume app frontend work consumes them.

**Exit:** garden publication components are CLJS-native or replaced by a CLJS UI package.

### T8 — Archive disposition and legacy dependency breakage

**Blocks:** final all-TS-zero claim; may also block `pseudo/clients` if it still depends on `@promethean-os/persistence`.

**Archive packages:**

- `archive/embedding` (1)
- `archive/persistence` (51)
- `archive/reconstituter` (12)
- `archive/semantic-graph-builder` (11)

**Goal:** do not port dead code by default. For each archive package, choose one of:

1. delete/remove from workspace,
2. keep as inert historical artifact outside active build/source inventory,
3. port only if a live package still depends on it and no better canonical OpenPlanner replacement exists.

**Exit:** archive TS is either removed from active source inventory or has a signed reason to remain outside the no-TS gate.

### T9 — Tooling/config/test final sweep

**Blocks:** final TypeScript-free monorepo assertion.

**Scope:** remaining `.config.ts`, `.d.ts`, TS test files, tsconfig references, tsx/tsup/playwright/ava config files, package `types` fields, and stale devDependencies (`typescript`, `tsx`, `tsup`, `@types/*`) after all ports.

**Exit:** `find` returns zero active `.ts/.tsx/.cts/.mts` source files outside explicitly generated artifacts; CI no-new-TS gate passes with an empty allowlist.

## Critical path

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

## Definition of done for the epic

- Active inventory count is zero for `.ts`, `.tsx`, `.cts`, `.mts`, and `.d.ts` source files outside generated build output.
- OpenPlanner root service, Graph Weaver imported/standalone modes, Knoxx frontend/backend, signal packages, pseudo clients, and graph packages build/test from CLJS.
- Archive code has explicit disposition and is not part of active source inventory.
- TypeScript dependencies and tsconfig/tooling files are removed unless only used for external generated artifacts with documented reason.
- CI prevents new TypeScript source unless a migration owner updates the roadmap and allowlist.
