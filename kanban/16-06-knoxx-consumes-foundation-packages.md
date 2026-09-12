---
uuid: "openplanner-16-06-knoxx-consumes-foundation-packages"
title: "16-06: Knoxx Consumes Foundation Packages, In-Tree Copies Deleted"
status: proposed
priority: P1
labels: ["tasks", "5sp", "decomposition", "knoxx", "cutover", "cleanup"]
created_at: "2026-06-06T00:00:00Z"
category: "tasks"
---

# 16-06: Knoxx Consumes Foundation Packages, In-Tree Copies Deleted

**Epic:** 16 — Extraction Foundation
**Depends on:** 16-02, 16-03, 16-04, 16-05

## Description

The cutover. Knoxx backend switches every extern/shape import to the published
`@open-hax/*` packages, the in-tree copies are deleted, and third-party deps that moved
into packages (`discord.js`, fastify interop deps) are dropped from knoxx's own
`package.json`.

This is the task that proves the whole extraction protocol end-to-end: scaffold → move →
publish → consume → delete → gate. Every later epic repeats this shape.

## Acceptance Criteria

- All `knoxx.backend.extern.*` requires (except `extern/agent_*`) rewritten to package
  namespaces; all `knoxx.backend.shape.{number,parse,path,url,pipeline}` requires
  rewritten to `@open-hax/shapes` namespaces
- In-tree copies deleted:
  - `extern/{js,json,promise,fetch,node_fs,websocket,multipart,row_extra,fastify,tools,discord,eta_mu,extension,proxx}.cljs`
    (minus any 16-04 carve-out recorded for `extension.cljs`)
  - `shape/{number,parse,path,url,pipeline}.cljs`
- `extern/agent_*.cljs` remain in-tree with a header comment pointing at E19
- Knoxx `package.json`: `discord.js` and other moved third-party deps removed; pinned
  `@open-hax/extern-*` + `@open-hax/shapes` versions added
- `grep -rn "knoxx.backend.extern" backend/src/` returns only `extern.agent_*` hits
- `grep -rn "knoxx.backend.shape.(number|parse|path|url|pipeline)" backend/src/` returns zero hits
- Knoxx standalone CI green on published versions; monorepo dev green on workspace links
- No behavior change: full knoxx test suite identical pass count

## Implementation Location

`packages/agents/knoxx/backend/` — imports, package.json, deletions

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. Knoxx standalone CI green consuming published versions
5. **Code review:** Dispatch a code review sub-agent. No critical issues before done.
