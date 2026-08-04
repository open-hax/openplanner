---
uuid: "openplanner-16-04-extract-integration-externs"
title: "16-04: Extract Integration Externs → Per-Adapter Packages"
status: proposed
priority: P1
labels: ["tasks", "3sp", "decomposition", "externs", "discord", "packages"]
created_at: "2026-06-06T00:00:00Z"
category: "tasks"
---

# 16-04: Extract Integration Externs → Per-Adapter Packages

**Epic:** 16 — Extraction Foundation
**Depends on:** 16-01

## Description

Move the third-party-integration boundary adapters into small per-adapter packages
(no junk drawer — each adapter is its own package because each carries its own npm
dependency):

- `extern/discord.cljs` → `packages/externs/discord` (`@open-hax/extern-discord`, carries `discord.js`)
- `extern/eta_mu.cljs` → `packages/externs/eta-mu` (`@open-hax/extern-eta-mu`, carries `@open-hax/eta-mu-cli`)
- `extern/extension.cljs` → `packages/externs/extension` (`@open-hax/extern-extension`)
- `extern/proxx.cljs` → `packages/externs/proxx` (`@open-hax/extern-proxx`)

These adapters become the injection points for E17 tool packs (Discord pack imports
`@open-hax/extern-discord`, etc.).

## Acceptance Criteria

- Four packages scaffolded from the 16-01 template
- Namespaces moved + renamed; each package declares its own third-party npm deps
- Knoxx no longer needs `discord.js` directly after 16-06 (dep moves to the package)
- Tests move with the namespaces; add smoke tests where none exist
- Packages published; knoxx cutover deferred to 16-06

## Implementation Location

`packages/externs/{discord,eta-mu,extension,proxx}/`

## Source Notes

- Source: `packages/agents/knoxx/backend/src/cljs/knoxx/backend/extern/`
- `extension.cljs` may be knoxx-specific (eta-mu extension runtime) — if extraction
  reveals it is pure distro opinion, leave it in-tree and record why (acceptance
  criteria shrink to three packages)

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent. No critical issues before done.
