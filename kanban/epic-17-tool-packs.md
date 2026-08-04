---
uuid: "openplanner-tool-packs"
title: "Epic: Tool Packs — Creative & Integration Tools as Packages"
status: incoming
priority: P1
labels: ["epic", "knoxx", "decomposition", "tools", "creative", "packages"]
created_at: "2026-06-06T00:00:00Z"
category: "epic"
---

# Epic 17: Tool Packs — Creative & Integration Tools as Packages

## Objective

Extract Knoxx's domain tool modules — the creative showcase — into standalone tool-pack
packages, fronted by a small `tool-pack-core` interface that defines how a pack registers
its tools into any runtime's tool catalog.

These are the pieces that make Knoxx the worldbuilding/creative demo: music identification
and analysis, Discord chat/voice, social (Bluesky/Twitch), OpenUtau synthesis, media
handling, and sandboxed container execution. As packages, they become platform
capabilities any distribution can compose.

## Key Design Decisions

- `packages/tool-packs/core` defines the **ToolPack interface**: tool descriptors
  (TypeBox/Malli schemas), registration fn, capability requirements (which clients/externs
  a pack needs injected)
- One package per domain: `tool-packs/{music,discord,social,openutau,media,sandbox}`
- Packs receive their effectful clients (Discord.js adapter, fetch, container exec) as
  injected parameters — no global singletons
- `domain/tools.cljs` shared utilities move into `tool-pack-core`
- Knoxx's tool catalog (`infra/agent/tool-catalog.cljs`) gains a thin adapter that
  registers ToolPacks — the catalog itself is not extracted yet (that's E19)
- Structural extraction only; tool behavior unchanged

## Dependencies

- Epic 16 (package template, extern packages — packs import `@open-hax/extern-*`)

## Verification Gate (non-negotiable)

Same gate as Epic 16: shadow-cljs test/lib compile clean, clj-kondo clean, knoxx
standalone CI green on published versions, code-review sub-agent with no critical issues.

## Definition of Done

- ToolPack interface published as `@open-hax/tool-pack-core`
- Six tool-pack packages published
- Knoxx registers all packs through the interface; zero in-tree tool domain code remains
- A pack can be registered into a bare runtime without Knoxx (smoke test in pack CI)

## Tasks

| Task | Points | Depends On | Status |
|------|--------|-----------|--------|
| 17-01: ToolPack interface + `tool-pack-core` | 5 | E16 | Proposed |
| 17-02: Music tool pack | 3 | 17-01 | Proposed |
| 17-03: Discord tool pack (chat, voice, reactions) | 5 | 17-01 | Proposed |
| 17-04: Social tool pack (Bluesky, Twitch) | 3 | 17-01 | Proposed |
| 17-05: OpenUtau + media tool packs | 3 | 17-01 | Proposed |
| 17-06: Sandbox-container tool pack | 3 | 17-01 | Proposed |
| 17-07: Knoxx registers packs via interface; in-tree copies deleted | 3 | 17-02..17-06 | Proposed |

**Total: 25 points**
