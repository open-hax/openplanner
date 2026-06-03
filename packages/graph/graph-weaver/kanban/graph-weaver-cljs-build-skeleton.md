---
uuid: "graph-weaver-cljs-build-skeleton"
title: "Create Graph Weaver CLJS build skeleton and ESM exports"
status: incoming
priority: P1
labels: ["tasks", "3sp", "cljs", "graph-weaver", "shadow-cljs", "esm", "typescript-retirement"]
created_at: "2026-06-01T17:40:58Z"
source: "split-from:graph-weaver-cljs-fastify-plugin-integration"
points: 3
category: "tasks"
---
# Create Graph Weaver CLJS build skeleton and ESM exports

## Intent

Create the minimal ClojureScript build/runtime skeleton for `packages/graph/graph-weaver` so future migration slices can land in CLJS without adding new TypeScript implementation code.

This is the first implementation-enabling split from `graph-weaver-cljs-fastify-plugin-integration`. It should follow Knoxx backend's CLJS ESM export pattern and make compiled CLJS the authoritative package API.

## Constraints

- Do **not** add new business logic in TypeScript.
- Do **not** grow `src/server.ts` except for an explicitly temporary shim with a deletion condition.
- Do **not** place any work under `archive/embedding/src/`.
- Do **not** change Graph Weaver runtime behavior in this card beyond adding inert/skeletal CLJS entrypoints.
- Keep package license as GPL-3.0-or-later.

## Current package context

Current `package.json` is TypeScript-first:

```json
{
  "main": "./dist/server.js",
  "types": "./dist/server.d.ts",
  "scripts": {
    "dev": "tsx src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "tsx": "^4.20.6"
  }
}
```

This card should introduce the CLJS build shape before deleting TypeScript so later cards can port modules incrementally and verify exports.

## Target files

Expected new/updated files:

```text
packages/graph/graph-weaver/
  shadow-cljs.edn
  deps.edn                    ; if needed for CLJS deps/tooling parity
  src/cljs/open_hax/graph_weaver/
    runtime.cljs              ; create-runtime-js placeholder
    plugin.cljs               ; register-plugin! placeholder
    standalone.cljs           ; start! placeholder
    entrypoint.cljs           ; optional standalone init-fn
    extern/fastify.cljs       ; Fastify boundary helpers, copied/adapted from Knoxx pattern
  test/cljs/open_hax/graph_weaver/
    runtime_test.cljs
```

`package.json` should expose compiled CLJS ESM output as the package API while allowing a temporary compatibility command only if required.

## Public API contract

Compiled CLJS ESM must export these names, even if the first implementation is skeletal:

```text
createGraphWeaverRuntime(opts) -> runtime
registerGraphWeaverPlugin(app, opts) -> Promise/thenable
startStandalone(opts) -> Promise<{ app, runtime, close }>
```

The first skeleton can return explicit "not implemented yet" status maps for runtime methods, but it must compile and be importable from Node.

## Knoxx pattern references

Reuse patterns from:

- `packages/agents/knoxx/backend/shadow-cljs.edn` — `:target :esm`, `:modules`, JS-callable `:exports`, `:keep-as-import`.
- `packages/agents/knoxx/backend/src/cljs/knoxx/backend/infra/http_server.cljs` — Fastify construction/lifecycle shape.
- `packages/agents/knoxx/backend/src/cljs/knoxx/backend/extern/fastify.cljs` — raw Fastify boundary isolation.
- `packages/agents/knoxx/backend/src/cljs/knoxx/backend/bootstrap.cljs` — separate durable runtime from HTTP app lifecycle.

## Acceptance criteria

- `shadow-cljs.edn` exists for Graph Weaver and builds an ESM artifact under `dist` or a clearly named CLJS output directory.
- The package exports `createGraphWeaverRuntime`, `registerGraphWeaverPlugin`, and `startStandalone` from compiled CLJS.
- A Node smoke command can import the compiled ESM and verify those exports are functions.
- No new TypeScript business logic is introduced.
- Any TypeScript compatibility shim is tiny, documented in the card/commit, and has a deletion condition.
- Follow-up migration cards can port pure modules (`graph`, `store`, `layout`, `config`) without needing to revisit build layout.

## Verification plan

```bash
pnpm -C orgs/open-hax/openplanner/packages/graph/graph-weaver build
node -e "import('./orgs/open-hax/openplanner/packages/graph/graph-weaver/dist/app.js').then(m => console.log(Object.keys(m)))"
```

Adjust the import path to the final CLJS module path chosen in `shadow-cljs.edn`.
