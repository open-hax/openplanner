# Package Decomposition Phase 5 — Split Tools

**Parent:** `package-decomposition-roadmap.md`
**Story Points:** 5
**Status:** todo

## Goal

Split the tool registry into generic core tools and Discord-specific tools.

## Scope

### In Scope
- Create `@promethean-os/agent-tools-core` (web, browser, vision, memory, peer)
- Create `@promethean-os/discord-bot-tools` (speak, search, tenor)
- Move tool executor to `agent-llm` or keep in tools-core
- Define tool registry contract

### Out of Scope
- Mind tools (Phase 6)
- IRC tools (follow Discord pattern later)

## Tasks

- [ ] Create `packages/agent-tools-core/`
- [ ] Create `packages/discord-bot-tools/`
- [ ] Split `llm/tools/registry.ts` by domain
- [ ] Move web, browser, vision, memory, peer tools to `agent-tools-core`
- [ ] Move Discord and Tenor tools to `discord-bot-tools`
- [ ] Update tool executor to compose registries
- [ ] Update imports in `cephalon-ts`
- [ ] Add tool tests

## Acceptance Criteria

- [ ] `@promethean-os/agent-tools-core` has generic tools
- [ ] `@promethean-os/discord-bot-tools` has Discord tools
- [ ] Tool executor composes multiple registries
- [ ] Tool tests pass

## Dependencies

- Phase 2 (discord-bot-adapter) — Discord tools need adapter
- Phase 4 (agent-llm) — tool executor needs provider

## Blocking

- None (tools are leaf dependencies)
