# pseudo/

Notes, scratch code, and reference material.

Packages here are **excluded from `pnpm -r build` and `pnpm -r test`** by default.
Only the packages listed explicitly in `pnpm-workspace.yaml` participate in
workspace builds — those are real library dependencies used by `packages/` or
`archive/` packages.

## What belongs here

- Prototyping and experiments
- Reference implementations and docs
- Scratch CLJS/TS clients not yet promoted to `packages/`
- Ad-hoc tooling and one-off scripts

## What does NOT belong here

- Production libraries depended on by other workspace packages
  → promote to `packages/`
- Frozen/legacy code
  → move to `archive/`

## Current contents

| Directory | Status | Notes |
|-----------|--------|-------|
| `aether/` | scratch | Experimental |
| `clients/` | scratch | CLI client, pre-existing zod4 type errors |
| `graph-runtime/` | reference | Specs and docs only |
| `janus/` | scratch | Standalone tool |
| `logger/` | **workspace dep** | Used by `archive/persistence` |
| `mcp-oauth/` | scratch | MCP OAuth service |
| `ollama-queue/` | scratch | Queue processor |
| `opencode-cljs-client/` | **workspace dep** | Used by `archive/reconstituter` |
| `opencode-interface-plugin/` | reference | JS-only plugin |
| `opencode-openplanner-plugin-cljs/` | scratch | OpenCode plugin CLJS build |
| `openplanner-cljs-client/` | **workspace dep** | Used by cephalon, reconstituter |
| `test-utils/` | **workspace dep** | Used by `archive/event` |
| `workbench/` | scratch | Dev workbench UI |

**Workspace dep** = listed in `pnpm-workspace.yaml`, participates in builds.
