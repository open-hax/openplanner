# Package Decomposition Phase 6 — Extract Agent Mind

**Parent:** `package-decomposition-roadmap.md`
**Story Points:** 2
**Status:** todo

## Goal

Extract mind systems (local graph, eidolon, prompt field) into `@promethean-os/agent-mind`.

## Scope

### In Scope
- Create `@promethean-os/agent-mind` package
- Move TS `mind/local-mind-graph.ts`, `mind/eidolon-field.ts`, `mind/prompt-field.ts`, `mind/rss-poller.ts`
- Move CLJS `sys/eidolon.cljs`, `sys/eidolon_vectors.cljs`, `eidolon/*`
- Define mind system interfaces

### Out of Scope
- Memory layer (Phase 3)
- Personality systems (Phase 1)

## Tasks

- [ ] Create `packages/agent-mind/`
- [ ] Move TS mind system files
- [ ] Move CLJS eidolon systems
- [ ] Define `MindSystem` interface/protocol
- [ ] Export local graph, eidolon, prompt field
- [ ] Update imports in `cephalon-ts` and `cephalon-cljs`
- [ ] Add mind system tests

## Acceptance Criteria

- [ ] `@promethean-os/agent-mind` exists with interface
- [ ] Local graph, eidolon, prompt field available
- [ ] RSS poller available
- [ ] Mind system tests pass

## Dependencies

- Phase 3 (agent-memory) — mind may use memory for context

## Blocking

- None (mind is optional enhancement)
