---
uuid: "openplanner-knoxx-decomposition-roadmap"
title: "Knoxx Decomposition Roadmap — Platform Packages + Distribution"
status: incoming
priority: P1
labels: ["roadmap", "knoxx", "decomposition", "packages", "distribution", "architecture"]
created_at: "2026-06-06T00:00:00Z"
category: "specs"
---

# Knoxx Decomposition Roadmap — Platform Packages + Distribution

Date: 2026-06-06
Status: proposed

## Purpose

Decompose Knoxx into neutral platform packages under `packages/` — the same way the
event ledger already lives in `packages/event-ledger/` — until Knoxx can be built
*entirely* out of those packages.

**Knoxx becomes a specific, opinionated distribution of the platform**: the personal
preference build, the demo given to clients to show what can be done, a daily tool for
worldbuilding and creative work — and the full showcase of everything the OpenPlanner
system is capable of. The packages are the platform; Knoxx is one composition of them.
Anyone (including future client engagements) could compose a different distribution
from the same parts.

## Architecture rules

1. **Packages are neutral platform capabilities** — no `knoxx-*` prefixes. Knoxx-the-distro
   is the only place the Knoxx identity lives.
2. **Structural moves first** — every extraction preserves behavior and is verified by the
   existing test suite. Ledger/protocol wiring is a separate, final epic (E22).
3. **Published packages** — extracted packages publish to npm under `@open-hax/*`
   (precedent: `uxx`, `eta-mu-cli`, `garden-publication-components` are already consumed
   by Knoxx as published packages). In-monorepo dev uses pnpm workspace links.
4. **Knoxx stays at `packages/agents/knoxx`** — it just gets thinner as packages are
   extracted out of it. No relocation churn.
5. **Four-layer architecture is preserved inside each package** — `domain` (pure),
   `infra` (effectful), `shape` (structure-only), `law/contract` (validators). Boundary
   contracts (Malli) at every cross-layer call.
6. **Extern boundary isolation is preserved** — raw JS interop only in extern packages;
   capability packages receive CLJS maps.
7. **CLJS only — no new TypeScript** (same rule as the event-ledger roadmap).
8. **Zero-warnings gate on every task** — shadow-cljs test + lib compile, clj-kondo,
   code-review sub-agent. Same non-negotiable gate as Epic 14.

## Target package map

| Package | npm name | Extracted from (knoxx backend) | Epic |
|---------|----------|-------------------------------|------|
| `packages/externs/node-core` | `@open-hax/extern-node-core` | `extern/{js,json,promise,fetch,node_fs,websocket,multipart,row_extra}` | E16 |
| `packages/externs/fastify` | `@open-hax/extern-fastify` | `extern/{fastify,tools}` | E16 |
| `packages/externs/discord`, `…/eta-mu`, `…/extension`, `…/proxx` | `@open-hax/extern-*` | `extern/{discord,eta_mu,extension,proxx}` | E16 |
| `packages/shapes` | `@open-hax/shapes` | `shape/{number,parse,path,url,pipeline}` | E16 |
| `packages/tool-packs/core` | `@open-hax/tool-pack-core` | tool catalog registration interface | E17 |
| `packages/tool-packs/{music,discord,social,openutau,media,sandbox}` | `@open-hax/tool-pack-*` | `domain/{music,discord,bluesky,twitch,openutau,media,sandbox-container}` | E17 |
| `packages/agent-stores` | `@open-hax/agent-stores` | `infra/stores/*` (mongo twins, composite, registry), `shape/{session_persistence,memory_sessions}` | E18 |
| `packages/policy-engine` | `@open-hax/policy-engine` | `domain/policy`, `infra/auth`, `infra/db/policy`, `infra/stores/mongo_policy_*`, `shape/db/*`, contract loading | E18 |
| `packages/model-providers` | `@open-hax/model-providers` | `infra/agent/provider`, `infra/clients/provider-catalog`, `shape/agent/provider` | E19 |
| `packages/agent-runtime` | `@open-hax/agent-runtime` | `infra/agent/*`, `domain/agent/*`, `shape/agent/*`, `extern/agent_*` | E19 |
| `packages/control-runtime` | `@open-hax/control-runtime` | `infra/{event-runtime,trigger-runner,pipeline-runner}`, `domain/{control,event,driver}` | E20 |
| `packages/http-host` | `@open-hax/http-host` | `infra/{http,http-server,lifecycle,graceful-shutdown,system-instance}` | E20 |
| *(route modules)* | — | `infra/routes/*` decomposed into per-capability route exports | E20 |
| `packages/agents/knoxx` *(distro)* | `@open-hax/knoxx-*` | composition root: config + contracts + wiring + opinionated frontend | E21 |

## Program shape

```
E16: Extraction Foundation ──┬── E17: Tool Packs ────────────┐
(template, externs, shapes)  │   (creative showcase)          │
                             │                                │
                             ├── E18: Stores + Policy ──┐     │
                             │   (needs E15 landed)     │     │
                             │                          ↓     ↓
                             │              E19: Agent Runtime
                             │                          │
                             └── E20: Control + HTTP ───┤
                                                        ↓
                                          E21: Knoxx Distribution
                                                        ↓
                                          E22: Ledger Adoption
                                          (merges with event-ledger M5)
```

## Milestones

| Phase | Epic | Name | Points | Exit signal |
|-------|------|------|--------|-------------|
| K1 | 16 | Extraction foundation | 24 | Package template proven, externs + shapes published, knoxx consumes them, in-tree copies deleted |
| K2 | 17 | Tool packs | 25 | Tool-pack interface defined; music/discord/social/openutau/media/sandbox are packages; knoxx registers them via the interface |
| K3 | 18 | Stores + policy engine | 22 | `agent-stores` and `policy-engine` published; knoxx has no in-tree store or policy code |
| K4 | 19 | Agent runtime | 28 | `agent-runtime` + `model-providers` published; knoxx's agent loop is package wiring |
| K5 | 20 | Control + HTTP composition | 21 | `control-runtime` + `http-host` published; routes are per-capability exports composed by the distro |
| K6 | 21 | Knoxx as distribution | 16 | Knoxx backend = composition root (config + contracts + wiring); "build your own distro" guide exists |
| K7 | 22 | Ledger adoption | TBD | Extracted packages speak `event-ledger` + `openplanner-protocols`; merges with event-ledger M5 |

**Total grounded: 136 points** (+ E22, broken down when E21 nears)

## Dependencies & sequencing with the event-ledger roadmap

- **E16 depends on 14-05 + 14-06 landing** (event-ledger M3 exit). Do not extract
  `extern/pg.cljs` or Redis plumbing that 14-05 is about to delete.
- **E15 (auth lifecycle, M4) should land before E18** — both touch auth/policy.
  E15 can run in parallel with E16/E17.
- **E17 and E18 can run in parallel** after E16.
- **E19 needs E16 + E18** (runtime is parameterized over stores + policy) and uses
  E17's tool-pack interface for its tool catalog.
- **E20 route modules** depend on the capability packages they expose (E17–E19),
  but `http-host` and `control-runtime` extraction can start right after E16.
- **E22 merges with event-ledger M5** — by the time the packages exist, "all systems
  project from the ledger" and "packages speak the ledger" are the same work item.

## Extraction protocol (every package, every epic)

1. **Scaffold** from the package template (16-01): shadow-cljs lib build, test runner,
   clj-kondo config, CI job, publish flow.
2. **Move** the namespaces — `git mv`-style, preserving history where possible.
   Rename `knoxx.backend.*` → package-local namespace roots.
3. **Sever** knoxx-specific assumptions: config defaults, hard-coded collection names,
   global singletons become injected parameters.
4. **Publish** a version; knoxx consumes the pinned version (workspace link in dev).
5. **Delete** the in-tree copy. Knoxx's namespace aliases may temporarily re-export
   during a transition window inside an epic, but no epic closes with dual copies.
6. **Gate**: shadow-cljs compile test (0 failures) + lib (0 warnings), clj-kondo
   (0 errors, 0 warnings), code-review sub-agent, knoxx standalone CI green.

## What this roadmap says explicitly

1. The packages are the platform; Knoxx is one opinionated composition of them
2. Extraction is structural — behavior change is a separate epic, never smuggled in
3. The creative tool packs (music, openutau, media, worldbuilding surfaces) are
   first-class platform capabilities, not Knoxx internals
4. The agent runtime is the crown jewel and is extracted late, after its dependencies
   (stores, policy, providers, tool catalog) are already packages
5. Knoxx-the-submodule keeps working standalone at every step — published packages,
   not monorepo-only links
6. E22 closes the loop with the event-ledger roadmap: the decomposed platform is
   what finally lands on the ledger end-to-end
