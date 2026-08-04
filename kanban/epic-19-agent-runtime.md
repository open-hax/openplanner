---
uuid: "openplanner-agent-runtime-package"
title: "Epic: Agent Runtime Package"
status: incoming
priority: P1
labels: ["epic", "knoxx", "decomposition", "agent-runtime", "providers", "streaming", "packages"]
created_at: "2026-06-06T00:00:00Z"
category: "epic"
---

# Epic 19: Agent Runtime Package

## Objective

Extract the crown jewel: Knoxx's agent runtime — orchestration loop, turn execution,
streaming pipeline, session state, transcript assembly, hydration, recovery — into
`@open-hax/agent-runtime`, parameterized over the packages extracted in E16–E18
(stores, policy, tool catalog, providers).

After this epic, Knoxx's agent loop is package wiring.

## Key Design Decisions

- `packages/model-providers` → `@open-hax/model-providers` extracted first:
  provider abstraction (`infra/agent/provider`), provider catalog
  (`infra/clients/provider-catalog`), `shape/agent/provider`
- `packages/agent-runtime` → `@open-hax/agent-runtime`: `infra/agent/*` (24 namespaces),
  `domain/agent/*` (pure turn logic), `shape/agent/*`, and the `extern/agent_*` adapters
  deferred from E16
- Runtime is **parameterized, not configured by globals**: it receives store adapters
  (`@open-hax/agent-stores` protocols), a policy checker (`@open-hax/policy-engine`),
  a tool catalog populated by ToolPacks (`@open-hax/tool-pack-core`), and a provider
  catalog (`@open-hax/model-providers`)
- `agent-context.cljs` (global execution context) becomes an explicit runtime handle
  passed through — the largest de-globalization in the program; gets its own spike task
- Hydration sources (memory, sources, contracts) injected as a hydration-source seq
- Structural extraction; turn semantics, streaming behavior, and recovery unchanged

## Dependencies

- Epic 16 (externs, shapes, template)
- Epic 18 (stores + policy are injection points)
- Epic 17's ToolPack interface (tool catalog population)

## Verification Gate (non-negotiable)

Same gate as Epic 16, plus: the full knoxx agent test suite (turns, streaming, recovery,
policy) runs against the packaged runtime with zero behavioral diffs.

## Definition of Done

- `@open-hax/model-providers` and `@open-hax/agent-runtime` published
- Knoxx backend has zero in-tree agent runtime namespaces
- A minimal "bare runtime" example boots from packages alone (no Knoxx code) —
  the proof that a different distribution is possible

## Tasks

| Task | Points | Depends On | Status |
|------|--------|-----------|--------|
| 19-01: Extract `model-providers` package | 5 | E16 | Proposed |
| 19-02: De-globalization spike — runtime handle replaces `agent-context` | 5 | E18 | Proposed |
| 19-03: Extract `agent-runtime` package (parameterized) | 13 | 19-01, 19-02, 17-01 | Proposed |
| 19-04: Knoxx consumes runtime; bare-runtime example; in-tree copies deleted | 5 | 19-03 | Proposed |

**Total: 28 points**
