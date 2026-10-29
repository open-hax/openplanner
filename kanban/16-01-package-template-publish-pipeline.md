---
uuid: "openplanner-16-01-package-template-publish-pipeline"
title: "16-01: CLJS Package Template + Publish Pipeline"
status: proposed
priority: P1
labels: ["tasks", "5sp", "decomposition", "template", "publish", "infra"]
created_at: "2026-06-06T00:00:00Z"
category: "tasks"
---

# 16-01: CLJS Package Template + Publish Pipeline

**Epic:** 16 — Extraction Foundation
**Depends on:** 14-05, 14-06 (event-ledger M3 exit), knoxx submodule working tree committed

## Description

Establish the reusable machinery every extraction in E16–E21 will use: a CLJS package
template and a publish pipeline so Knoxx (a standalone submodule with its own CI) can
consume extracted packages as published `@open-hax/*` npm dependencies, while monorepo
dev uses pnpm workspace links.

**Decision to make (spike, recorded in the template doc):** CLJS source distribution
mechanism. Options:
1. npm packages shipping CLJS source (shadow-cljs resolves CLJS source from
   `node_modules` via `:js-options` / classpath inclusion)
2. compiled ESM lib output consumed as plain JS (loses CLJS-level reuse — macros,
   protocols across package boundary)
3. deps.edn git/local deps (bypasses npm; awkward for the submodule + pnpm story)

Precedent to weigh: knoxx already consumes `@open-hax/uxx` and `@open-hax/eta-mu-cli`
as published npm packages; `packages/event-ledger` is a CLJS shadow package in the
monorepo.

## Acceptance Criteria

- Template documented (e.g. `docs/architecture/cljs-package-template.md`): directory
  layout, `package.json` conventions, shadow-cljs lib + test builds, clj-kondo config,
  CI job, publish flow (NPM_TOKEN env auth, per existing publish conventions)
- Distribution mechanism decision recorded with rationale (the spike outcome)
- One seed package scaffolded from the template and published (may be an empty-ish
  `@open-hax/shapes` shell that 16-05 fills, or a trivial proof package)
- Knoxx backend successfully imports a namespace from the seed package in a smoke test,
  in both modes: published version (standalone CI) and workspace link (monorepo dev)
- pnpm workspace config updated so `packages/externs/*` and `packages/shapes` resolve

## Implementation Location

- `docs/architecture/cljs-package-template.md` — the template doc
- `packages/shapes/` or a proof package — the seed
- Root `pnpm-workspace.yaml` — glob updates

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors (seed package + knoxx)
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. Knoxx standalone CI green consuming the published seed version
5. **Code review:** Dispatch a code review sub-agent. No critical issues before done.
