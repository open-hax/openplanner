---
uuid: "openplanner-16-02-extract-core-node-externs"
title: "16-02: Extract Core Node Externs → packages/externs/node-core"
status: proposed
priority: P1
labels: ["tasks", "5sp", "decomposition", "externs", "packages"]
created_at: "2026-06-06T00:00:00Z"
category: "tasks"
---

# 16-02: Extract Core Node Externs → `packages/externs/node-core`

**Epic:** 16 — Extraction Foundation
**Depends on:** 16-01

## Description

Move the generic Node/JS interop adapters out of the Knoxx backend into
`packages/externs/node-core` (`@open-hax/extern-node-core`). These are pure boundary
adapters with zero domain coupling — the cheapest possible extraction, and the proof
run for the template.

**In scope:** `extern/{js,json,promise,fetch,node_fs,websocket,multipart,row_extra}.cljs`

**Explicitly out of scope:**
- `extern/agent_*.cljs` (agent_message, agent_runner, agent_turn_*) — travel with the
  agent runtime in E19
- `extern/pg.cljs` — deleted by 14-05; must not exist by the time this task starts

## Acceptance Criteria

- `packages/externs/node-core/` scaffolded from the 16-01 template
- The eight namespaces moved and renamed `knoxx.backend.extern.*` →
  `openhax.extern.node-core.*` (final root per template doc)
- Existing extern-level tests move with the namespaces; add smoke tests where none exist
- No knoxx-specific assumptions remain (config reads, hard-coded env var names beyond
  what the adapter genuinely owns)
- Package published; version pinned nowhere yet (knoxx cutover is 16-06)
- Knoxx tree untouched by this task except where the template requires registration —
  in-tree deletion happens in 16-06

## Implementation Location

`packages/externs/node-core/`

## Source Notes

- Source: `packages/agents/knoxx/backend/src/cljs/knoxx/backend/extern/`
- AGENTS.md rule preserved: raw JS interop only inside extern namespaces; consumers
  receive CLJS maps

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors (package CI)
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent. No critical issues before done.
