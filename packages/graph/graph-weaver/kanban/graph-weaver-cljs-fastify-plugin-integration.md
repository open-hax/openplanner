---
uuid: "graph-weaver-cljs-fastify-plugin-integration"
title: "Rewrite Graph Weaver as CLJS Fastify plugin integration"
status: in_progress
priority: P1
labels: ["tasks", "5sp", "cljs", "graph-weaver", "fastify-plugin", "typescript-retirement", "planning"]
created_at: "2026-06-01T17:32:14Z"
source: "user-intent:2026-06-01-graph-weaver-cljs-plugin-planning"
points: 5
category: "tasks"
---
# Rewrite Graph Weaver as CLJS Fastify plugin integration

## Intent

Graph Weaver should stop being treated as a separate TypeScript application silo. It should become a package-level capability that can be imported by OpenPlanner as a Fastify plugin while still being able to run as a standalone service for isolation, development, or deployment topology choices.

This is also the first explicit planning slice for the broader OpenPlanner monorepo direction: TypeScript in the OpenPlanner monorepo is legacy and should be rewritten to ClojureScript. Do not add new TypeScript implementation code for this work unless it is a temporary compatibility shim with a removal plan.

Knoxx backend CLJS is the current gold-standard pattern reference for new backend/runtime code.

## Desired architecture

```text
packages/graph/graph-weaver/
  src-cljs/ or cljs/
    plugin.cljs          ; Fastify plugin entrypoint
    runtime.cljs         ; graph-weaver runtime constructor/state machine
    standalone.cljs      ; optional standalone server wrapper
    graphql.cljs         ; GraphQL/query surface, if GraphQL remains the API shape
    openplanner_source.cljs ; OpenPlanner export/cursor source adapter
    redis_session.cljs   ; runtime/session coordination where needed
```

The same package should support two process topologies:

1. **Imported mode** — OpenPlanner registers the Graph Weaver Fastify plugin in-process.
2. **Standalone mode** — Graph Weaver starts its own Fastify server and registers the same plugin.

Runtime/session coordination should live in Redis where appropriate so plugin capabilities can run in one process or separate processes without semantic drift.

OpenPlanner/Mongo remains canonical graph truth. Graph Weaver should crawl/paginate OpenPlanner graph exports and accumulate enough local view state to show all nodes progressively, while only refreshing chunks/bounded projections each cycle.

## Boundaries and non-goals

- Do **not** put new work under `orgs/open-hax/openplanner/archive/embedding/src/`.
- Do **not** add new TypeScript implementation as the target architecture.
- Do **not** make Redis the durable graph store; Redis is coordination/session/runtime state.
- Do **not** delete standalone mode; make standalone mode a thin wrapper over the same plugin.
- Do **not** make Graph Weaver the canonical graph truth; it is a workbench/view/runtime surface over OpenPlanner truth.

## Planning pass

1. Inventory current `packages/graph/graph-weaver/src/*.ts` responsibilities and classify them as:
   - plugin surface
   - runtime state
   - OpenPlanner source adapter
   - GraphQL/query schema
   - UI/static asset serving
   - WebSocket invalidation
   - standalone-only wiring
2. Read Knoxx backend CLJS patterns and choose the project-local CLJS shape for Fastify plugin authoring.
3. Define the CLJS package/build layout and interop boundary for registering a Fastify plugin from OpenPlanner.
4. Define Redis-backed runtime/session coordination needed for imported vs standalone parity.
5. Split the migration into small follow-up cards that retire TypeScript files rather than growing them.

## Acceptance criteria

- A written migration plan maps each current Graph Weaver TypeScript module to a CLJS destination or deletion path.
- The plan identifies the minimal compatibility shim, if any, and its removal condition.
- The target API exposes a Fastify plugin that OpenPlanner can register in-process.
- The same package has a standalone runner using the same plugin/runtime.
- GraphQL/status/graph snapshot/WebSocket/static UI surfaces have an explicit CLJS owner module.
- Redis usage is limited to runtime/session/process coordination and documented as optional where possible.
- No new implementation is placed in `archive/embedding/src/`.

## Kanban anchors

- `kanban/monorepo-roadmap.md` — P1B graph-memory coherence and OpenPlanner as canonical graph truth.
- `packages/graph/graph-weaver/kanban/service-surface.md` — existing GraphQL/status/graph/UI/WebSocket service surface.
- `packages/graph/graph-weaver/kanban/graph-layers-and-storage.md` — layered graph model and OpenPlanner semantic import.
- `pseudo/graph-runtime/kanban/decomposition-roadmap.md` — split into clear contracts, not amnesiac fragments.

## Inventory pass 1 — current TypeScript responsibilities

Current Graph Weaver TypeScript surface is 15 files / ~5.1k lines. Migration should retire these files by moving responsibilities into CLJS modules, not by expanding the TypeScript surface.

| Current TS module | Main responsibility | CLJS destination | Fate |
| --- | --- | --- | --- |
| `src/server.ts` | Monolithic `node:http` server, route dispatch, static files, WebSocket upgrade, runtime state, timers, ACO crawler wiring, config persistence, local/OpenPlanner/lake rebuilds, GraphQL context implementation, signal shutdown | Split into `open-hax.graph-weaver.runtime`, `plugin`, `standalone`, `routes.http`, `routes.websocket`, `static`, `crawler.aco`, `sync.scheduler` | Delete after CLJS standalone runner and Fastify plugin export cover all routes/status/ws/static behavior |
| `src/graphql.ts` | GraphQL schema string, HTTP handler, root resolvers, auth guard, GraphQL DTO conversion | `open-hax.graph-weaver.graphql.schema`, `graphql.resolvers`, `graphql.http` | Port to CLJS; keep GraphQL schema data/string close to resolvers; no TS shim after port |
| `src/mongo-graph-store.ts` | Mongo-backed graph persistence, semantic field/daimoi audit reads, indexes, connect/retry lifecycle | `open-hax.graph-weaver.store.mongo`, plus `store.semantic-field`/`store.daimoi` if split | Port to CLJS Mongo interop or replace with OpenPlanner API reads where canonical truth makes direct local store unnecessary |
| `src/store.ts` | In-memory graph store, search indexes, edge indexes, merge stores | `open-hax.graph-weaver.store.memory` | Port early; pure data structure and best first CLJS unit-test target |
| `src/openplanner-graph.ts` | Fetch `/v1/graph/export`, normalize exported nodes/edges, push layout upserts back to OpenPlanner | `open-hax.graph-weaver.sources.openplanner` | Port and extend to cursor/paginated crawl; current capped snapshot behavior is insufficient |
| `src/config.ts` | Env defaults and runtime config patch normalization | `open-hax.graph-weaver.config` | Port as data-first CLJS config; expose JS config object from ESM build for callers |
| `src/scan.ts` | Local repo scan to graph nodes/edges using git file list and import/link extraction | `open-hax.graph-weaver.sources.repo-scan` | Port or demote behind dev-only feature flag; not central to OpenPlanner canonical graph truth |
| `src/preview.ts` | File/URL preview, content type/language guessing, binary guards | `open-hax.graph-weaver.preview` | Port; route-level callers should receive CLJS maps and only convert at Fastify boundary |
| `src/lakes.ts` | Fetch OpenPlanner lakes/gardens and build lake/garden graph nodes | `open-hax.graph-weaver.sources.openplanner-lakes` | Port; likely folds into `sources.openplanner` after paginated export is defined |
| `src/layout.ts` | Deterministic fallback layout positions | `open-hax.graph-weaver.layout.fallback` | Port as pure functions; keep layout writes going through OpenPlanner layout API |
| `src/git.ts` | Git root discovery and tracked-file listing | `open-hax.graph-weaver.infra.git` | Port only if repo-scan remains; otherwise delete with repo-scan retirement |
| `src/imports.ts` | Extract JS/TS, Python, Clojure require/import edges | `open-hax.graph-weaver.sources.imports` | Port only if repo-scan remains; TS import extractor becomes legacy/dev-only |
| `src/markdown.ts` | Markdown link extraction | `open-hax.graph-weaver.sources.markdown` | Port only if repo-scan remains |
| `src/persist.ts` | JSON file read/write for local config/user graph state | `open-hax.graph-weaver.infra.persist` | Prefer Redis/OpenPlanner/Mongo-backed state; keep only for standalone dev config if needed |
| `src/graph.ts` | Graph node/edge/snapshot TS types | `open-hax.graph-weaver.shape.graph` | Replace with Malli/CLJS schema/data specs; no TS type authority |

## Knoxx CLJS pattern references

Observed Knoxx backend patterns to reuse:

- `backend/shadow-cljs.edn` builds `:target :esm` and exports JS-callable functions from CLJS modules.
- `knoxx.backend.bootstrap/start-http!` separates durable runtime state from HTTP app lifecycle and supports hot reload by rebuilding only the Fastify app.
- `knoxx.backend.infra.http-server` owns Fastify construction/default plugins while route namespaces register their own routes.
- `knoxx.backend.extern.fastify` isolates raw Fastify request/reply traversal and converts at the boundary.
- `knoxx.backend.infra.redis-client` wraps node-redis with small promise-returning helpers and keeps Redis optional when the URL is blank or connection fails.

Graph Weaver should copy these architectural moves, not necessarily the exact namespace names.

## Target CLJS build/API sketch

```edn
{:source-paths ["src/cljs" "test/cljs"]
 :builds
 {:app
  {:target :esm
   :output-dir "dist"
   :modules
   {:app
    {:exports
     {:createGraphWeaverRuntime open-hax.graph-weaver.runtime/create-runtime-js
      :registerGraphWeaverPlugin open-hax.graph-weaver.plugin/register-plugin!
      :startStandalone open-hax.graph-weaver.standalone/start!}}}}}}
```

Runtime functions should be designed so OpenPlanner can do imported mode without owning Graph Weaver internals:

```text
createGraphWeaverRuntime(opts) -> runtime
registerGraphWeaverPlugin(fastifyInstance, { runtime, prefix?, config? }) -> Promise/thenable
startStandalone(opts) -> Promise<{ app, runtime, close }>
```

The plugin owns route registration for:

- `GET/POST /graphql`
- `GET /api/status`
- `GET /api/graph`
- `POST /api/layout/upsert`
- `GET /ws` or Fastify websocket equivalent
- static Graph Weaver UI assets, preferably under a configurable prefix when imported

## Compatibility shim policy

The only acceptable compatibility layer is a thin package entrypoint that imports compiled CLJS ESM and re-exports the public API for existing package consumers. It must contain no business logic and must be removed once OpenPlanner imports the CLJS exports directly.

`src/server.ts` should not be grown. If a short-lived shim is unavoidable, it should be generated/built output or a tiny non-authoritative wrapper with a deletion issue/card.

## Follow-up cards to split from this plan

1. Create CLJS build skeleton for `packages/graph/graph-weaver` using Knoxx backend ESM export pattern.
2. Port pure graph shapes/store/layout/config to CLJS with tests.
3. Port OpenPlanner graph source as paginated/cursor crawl adapter.
4. Port GraphQL schema/resolvers and Fastify route registration.
5. Port WebSocket/static UI serving and standalone runner.
6. Remove TypeScript server/store modules after CLJS parity verification.
