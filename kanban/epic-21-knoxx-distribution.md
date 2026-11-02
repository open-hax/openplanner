---
uuid: "openplanner-knoxx-distribution"
title: "Epic: Knoxx as Distribution — Composition Root"
status: incoming
priority: P2
labels: ["epic", "knoxx", "distribution", "composition", "docs"]
created_at: "2026-06-06T00:00:00Z"
category: "epic"
---

# Epic 21: Knoxx as Distribution — Composition Root

## Objective

Knoxx becomes what it was always meant to be: a specific, opinionated distribution of the
platform packages. The personal-preference build, the client demo, the worldbuilding and
creative-work daily driver — and the full showcase of everything the OpenPlanner system
can do.

After E16–E20, the Knoxx backend should be reducible to: configuration, contracts (the
EDN policy/actor/trigger opinions), package wiring, the opinionated routes (studio,
workspace media, admin, app serving), and the frontend.

## Key Design Decisions

- Knoxx stays at `packages/agents/knoxx` — no relocation
- The backend's remaining `src/` is a **composition root**: a bootstrap that instantiates
  `http-host`, registers route modules, wires `agent-runtime` with stores/policy/providers/
  tool-packs, configures `control-runtime` drivers, and injects the `knoxx_*` collection
  names and contract sources
- The distro is the reference for "build your own": a documented guide shows how to
  compose a different distribution from the same packages (the client-engagement story)
- Audit pass deletes anything left in-tree that a package now owns
- Frontend integration with `openplanner-client` (Socket.IO) is scoped here only if E22
  hasn't started; otherwise it belongs to E22

## Dependencies

- Epics 16–20 all landed

## Verification Gate (non-negotiable)

Same gate as Epic 16, plus: full knoxx e2e suite green; the distro boots from published
package versions only.

## Definition of Done

- Knoxx backend = config + contracts + composition root + opinionated routes
- Zero platform-capability code in-tree
- "Build your own distribution" guide published (docs/)
- The demo story works: a fresh checkout of the knoxx submodule alone builds and runs
  the full showcase

## Tasks

| Task | Points | Depends On | Status |
|------|--------|-----------|--------|
| 21-01: Composition-root bootstrap refactor | 5 | E16–E20 | Proposed |
| 21-02: In-tree audit — delete everything a package owns | 3 | 21-01 | Proposed |
| 21-03: "Build your own distribution" guide + distro docs | 3 | 21-01 | Proposed |
| 21-04: Demo-path hardening (fresh checkout → full showcase) | 5 | 21-02 | Proposed |

**Total: 16 points**
