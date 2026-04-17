# Π Last — openplanner

**Date:** 2026-04-17
**Branch:** main
**Mode:** recursive fork tax

## What Changed

- **Removed all git submodules** — `.gitmodules` deleted; packages reorganized into embedded repos under category dirs
- **Reorganized monorepo layout:**
  - `packages/agents/` — knoxx (full stack), personality-system, circuits-octave
  - `packages/graph/` — graph-weaver, graph-weaver-aco, myrmex, webgl-graph-view, eros-eris-field, eros-eris-field-app
  - `packages/signals/` — signal-contracts, signal-radar-core, sintel
  - `archive/` — retired packages (embedding, event, persistence, reconstituter, semantic-graph-builder)
  - `pseudo/` — experimental/in-progress (workbench, clients, graph-runtime, janus, mcp-fs-oauth, openplanner-cljs-client, opencode-openplanner-plugin-cljs)
- **Updated `.gitignore`** — added .lsp/, target/, .vite/, .vite-vitest/, .reconstitute/, *.bak, *.backup, .projectile, package-lock.json, *.tsbuildinfo.*
- **Updated `pnpm-workspace.yaml`** — simplified to glob patterns (`packages/**`, `archive/**`, `pseudo/**`)
- **Updated `src/routes/v1/graph.ts`** — degree-0 node filtering, connected-component fill
- **Updated `.env`** — added embedding provider comments

## Submodule Migration Map

| Old Path | New Location |
|----------|-------------|
| `packages/knoxx` | `packages/agents/knoxx` (embedded) |
| `packages/cephalon` | `packages/agents/cephalon` (embedded) |
| `packages/graph-weaver` | `packages/graph/graph-weaver` (embedded) |
| `packages/graph-weaver-aco` | `packages/graph/graph-weaver-aco` (embedded) |
| `packages/myrmex` | `packages/graph/myrmex` (embedded) |
| `packages/eros-eris-field` | `packages/graph/eros-eris-field` (embedded) |
| `packages/eros-eris-field-app` | `packages/graph/eros-eris-field-app` (embedded) |
| `packages/workbench` | `pseudo/workbench` (embedded) |
| `packages/clients` | `pseudo/clients` (embedded) |
| `packages/janus` | `pseudo/janus` (embedded) |
| `packages/graph-runtime` | `pseudo/graph-runtime` (embedded) |
| `packages/mcp-fs-oauth` | `pseudo/mcp-fs-oauth` (embedded) |
| `packages/openplanner-cljs-client` | `pseudo/openplanner-cljs-client` (embedded) |
| `packages/opencode-openplanner-plugin-cljs` | `pseudo/opencode-openplanner-plugin-cljs` (embedded) |
| `packages/reconstituter` | `archive/reconstituter` (embedded) |

## Only Remaining Submodule

- `packages/vexx` — still a proper git submodule pointing to `open-hax/vexx`

## Concurrent Dirt

None observed.
