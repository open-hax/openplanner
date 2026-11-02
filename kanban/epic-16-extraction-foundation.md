---
uuid: "openplanner-extraction-foundation"
title: "Epic: Extraction Foundation — Package Template, Externs, Shapes"
status: incoming
priority: P1
labels: ["epic", "knoxx", "decomposition", "externs", "shapes", "packages"]
created_at: "2026-06-06T00:00:00Z"
category: "epic"
---

# Epic 16: Extraction Foundation — Package Template, Externs, Shapes

## Objective

Prove the extraction machinery on the lowest-risk seams. Establish the CLJS package
template + publish pipeline, then extract the generic extern adapters and shared shape
morphisms out of the Knoxx backend into neutral `packages/` packages that Knoxx consumes
as published `@open-hax/*` dependencies.

## Key Design Decisions

- Neutral capability names — no `knoxx-*` prefixes (knoxx is the distro, packages are the platform)
- Packages publish to npm under `@open-hax/*`; in-monorepo dev uses pnpm workspace links
  (precedent: knoxx already consumes `@open-hax/uxx`, `@open-hax/eta-mu-cli` as published deps)
- CLJS source distribution mechanism decided once in 16-01 and reused by every later epic
- `extern/agent_*.cljs` adapters are **excluded** — they travel with the agent runtime (E19)
- `extern/pg.cljs` is **excluded** — deleted by 14-05 before this epic starts
- Domain-specific shapes (`shape/agent/*`, `shape/db/*`, session shapes) are **excluded** —
  they travel with their owning capability packages (E18/E19)
- Structural moves only: behavior preserved, verified by the existing knoxx test suite

## Dependencies

- 14-05 (remove Redis + PG deps) and 14-06 — must land first so we don't extract dead code
- Knoxx submodule working tree committed (the 14-07 diff is currently uncommitted)

## Verification Gate (non-negotiable)

Every task in this epic **must** pass all of the following before marking done:

1. **Automated checks:**
```bash
npx shadow-cljs compile test   # 0 failures, 0 errors
npx shadow-cljs compile lib    # 0 warnings
npx clj-kondo --lint src test  # 0 errors, 0 warnings
```

2. **Knoxx standalone CI green** — the submodule builds and tests on its own, consuming
   published package versions (not monorepo links).

3. **Code review:** Dispatch a code review sub-agent to review all changed files. The task
   cannot be marked done until the reviewer returns with no critical issues.

## Definition of Done

- A documented, reusable CLJS package template + publish flow exists
- `packages/externs/{node-core,fastify,discord,eta-mu,extension,proxx}` published
- `packages/shapes` published
- Knoxx backend consumes all of the above as `@open-hax/*` deps
- Zero extern or generic-shape namespaces remain in-tree in the knoxx backend
  (except `extern/agent_*`, which awaits E19)

## Tasks

| Task | Points | Depends On | Status |
|------|--------|-----------|--------|
| 16-01: CLJS package template + publish pipeline | 5 | — | Proposed |
| 16-02: Extract core node externs → `externs/node-core` | 5 | 16-01 | Proposed |
| 16-03: Extract server externs → `externs/fastify` | 3 | 16-01 | Proposed |
| 16-04: Extract integration externs → per-adapter packages | 3 | 16-01 | Proposed |
| 16-05: Extract shared shapes → `packages/shapes` | 3 | 16-01 | Proposed |
| 16-06: Knoxx consumes packages, in-tree copies deleted | 5 | 16-02..16-05 | Proposed |

**Total: 24 points**
