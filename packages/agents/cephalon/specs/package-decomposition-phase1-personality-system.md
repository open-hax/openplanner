# Package Decomposition Phase 1 — Extract Personality System

**Parent:** `package-decomposition-roadmap.md`
**Story Points:** 3
**Status:** in-progress

## Goal

Extract the personality system into a pluggable architecture with the 8-circuit octave as the reference implementation.

## Scope

### In Scope
- Create `@promethean-os/personality-system` package (plugin contract)
- Create `@promethean-os/circuits-octave` package (8-circuit implementation)
- Move `circuits.ts` and `config/bots.ts` into `circuits-octave`
- Define `PersonalitySystem` protocol/interface

### Out of Scope
- Discord adapter extraction
- Tool extraction
- Memory/mind extraction

## Tasks

- [x] Create `packages/personality-system/` with plugin contract
- [x] Define `PersonalitySystem` interface/protocol
- [x] Create `packages/circuits-octave/` package
- [x] Move `circuits.ts` to `circuits-octave` (CLJS implementation)
- [ ] Move `config/bots.ts` to `circuits-octave` (TS migration not needed - CLJS is canonical)
- [ ] Update `cephalon-cljs` to import from `circuits-octave`
- [ ] Add tests for personality plugin loading

## Acceptance Criteria

- [x] `@promethean-os/personality-system` defines plugin contract
- [x] `@promethean-os/circuits-octave` implements 8-circuit personality
- [ ] `cephalon-cljs` imports circuits from new package
- [ ] Existing tests pass

## Dependencies

- Phase 0 (CLJS canonical establishment)

## Blocking

- Blocks Discord bot personality configuration in later phases
