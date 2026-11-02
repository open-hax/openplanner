---
uuid: "openplanner-control-http-composition"
title: "Epic: Control Runtime & HTTP Composition Packages"
status: incoming
priority: P2
labels: ["epic", "knoxx", "decomposition", "control", "triggers", "http", "routes", "packages"]
created_at: "2026-06-06T00:00:00Z"
category: "epic"
---

# Epic 20: Control Runtime & HTTP Composition Packages

## Objective

Extract the remaining infrastructure: the event/trigger/pipeline control runtime and the
HTTP host, and decompose Knoxx's REST/WebSocket routes into per-capability route modules
that a distribution composes onto its own Fastify instance.

## Key Design Decisions

- `packages/control-runtime` → `@open-hax/control-runtime`: `infra/event-runtime`,
  `infra/trigger-runner`, `infra/pipeline-runner`, `domain/control` (resource runtime
  catalog), `domain/event`, `domain/driver` (driver protocol); action handlers and
  drivers injected via registry
- `packages/http-host` → `@open-hax/http-host`: Fastify setup (`infra/http`,
  `infra/http-server`), lifecycle, graceful shutdown, `system-instance` singleton registry
  (with the 14-08 orphan reclaim behavior)
- **Route modules live with their capability packages**, not in a routes package:
  `policy-engine` exports auth routes, `agent-stores`/`agent-runtime` export session +
  agent routes, tool packs export their tool/proxy routes. `http-host` provides the
  composition API (`register-routes!`)
- Knoxx-specific routes (studio, workspace-media, admin, app asset serving) stay in the
  distro — they are the opinionated part
- Structural extraction; trigger semantics and route behavior unchanged

## Dependencies

- Epic 16 (externs: fastify, node-core)
- Route-module decomposition depends on E17/E18/E19 packages existing as homes
- `control-runtime` and `http-host` extraction can start right after E16

## Verification Gate (non-negotiable)

Same gate as Epic 16: shadow-cljs test/lib compile clean, clj-kondo clean, knoxx
standalone CI green on published versions, code-review sub-agent with no critical issues.

## Definition of Done

- `@open-hax/control-runtime` and `@open-hax/http-host` published
- Every generic route lives in its capability package; Knoxx composes them + its own
  opinionated routes through `http-host`
- Knoxx backend `infra/` contains only distro wiring

## Tasks

| Task | Points | Depends On | Status |
|------|--------|-----------|--------|
| 20-01: Extract `http-host` package | 5 | E16 | Proposed |
| 20-02: Extract `control-runtime` package | 8 | E16 | Proposed |
| 20-03: Decompose routes into per-capability modules | 8 | 20-01, E17, E18, E19 | Proposed |

**Total: 21 points**
