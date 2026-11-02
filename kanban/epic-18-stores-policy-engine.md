---
uuid: "openplanner-stores-policy-engine"
title: "Epic: Stores & Policy Engine Packages"
status: incoming
priority: P1
labels: ["epic", "knoxx", "decomposition", "stores", "policy", "auth", "mongo", "packages"]
created_at: "2026-06-06T00:00:00Z"
category: "epic"
---

# Epic 18: Stores & Policy Engine Packages

## Objective

Extract Knoxx's persistence layer and policy/authorization system into two platform
packages: `agent-stores` (the Mongo store twins from Epic 14, the composite store, the
registry) and `policy-engine` (contracts loading, actor resolution, authz checks,
role/capability model, policy stores).

Epic 14 made these Mongo-only; this epic makes them packages.

## Key Design Decisions

- `packages/agent-stores` → `@open-hax/agent-stores`: session, run, memory, titles,
  temp-memory, MCP OAuth, rate-limit stores + `session-store-registry` + composite store;
  store factory fns take a Mongo db handle + config (no global client singleton)
- `packages/policy-engine` → `@open-hax/policy-engine`: `domain/policy`, `infra/auth`
  (authz, session, token-hash), `infra/db/policy` (Mongo-only by then), all
  `mongo_policy_*` stores, `shape/db/*`
- Contract loading generalized: pluggable sources (filesystem EDN, API, DB) — Knoxx's
  `contracts/` directory becomes one configuration of the engine
- Collection names become config with current names as defaults (`knoxx_*` collection
  names are the Knoxx distro's opinion, injected by the distro)
- Structural extraction; store behavior and policy semantics unchanged

## Dependencies

- Epic 16 (template, externs)
- **Epic 15 (auth lifecycle) should land first** — E15 touches auth sessions and user
  events; extracting policy mid-flight would force a rebase of one onto the other.
  Reconcile `knoxx_policy_sessions` (14-04) vs E15's planned `auth_sessions` before
  extraction.

## Verification Gate (non-negotiable)

Same gate as Epic 16: shadow-cljs test/lib compile clean, clj-kondo clean, knoxx
standalone CI green on published versions, code-review sub-agent with no critical issues.

## Definition of Done

- `@open-hax/agent-stores` and `@open-hax/policy-engine` published
- Knoxx backend has zero in-tree store or policy namespaces
- Collection names injected by the distro; engine defaults are neutral
- All 14-x Mongo behavior (TTL indexes, `$inc` rate limits, OAuth flows) preserved
  under the package test suites

## Tasks

| Task | Points | Depends On | Status |
|------|--------|-----------|--------|
| 18-01: Extract `agent-stores` package | 8 | E16 | Proposed |
| 18-02: Extract `policy-engine` package | 8 | E16, E15 | Proposed |
| 18-03: Generalize contract loading (pluggable sources) | 3 | 18-02 | Proposed |
| 18-04: Knoxx consumes both; in-tree copies deleted | 3 | 18-01, 18-02 | Proposed |

**Total: 22 points**
