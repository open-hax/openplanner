# Package Decomposition Phase 8 — Extract Agent Runtime

**Parent:** `package-decomposition-roadmap.md`
**Story Points:** 3
**Status:** todo

## Goal

Extract the runtime core into `@promethean-os/agent-runtime` (CLJS ECS) with TS compatibility layer.

## Scope

### In Scope
- Create `@promethean-os/agent-runtime` (CLJS ECS as default implementation)
- Create `@promethean-os/agent-runtime-ts` (TS compatibility layer, deprecated)
- Move `ecs/*` to `agent-runtime`
- Move `sessions/manager.ts` and `runtime/temporal.ts` to `agent-runtime-ts`
- Define runtime interface

### Out of Scope
- TS retirement (later phase)
- Removing TS bridge

## Tasks

- [ ] Create `packages/agent-runtime/` with CLJS ECS core
- [ ] Move `cephalon-ecs` ECS modules to `agent-runtime`
- [ ] Create `packages/agent-runtime-ts/`
- [ ] Move TS session manager and temporal scheduler
- [ ] Define `AgentRuntime` interface/protocol
- [ ] Update imports in application packages
- [ ] Add runtime tests

## Acceptance Criteria

- [ ] `@promethean-os/agent-runtime` has CLJS ECS implementation
- [ ] `@promethean-os/agent-runtime-ts` has TS compatibility layer
- [ ] Runtime interface defined
- [ ] Runtime tests pass

## Dependencies

- Phase 7 (package rename) — need stable names first

## Blocking

- TS retirement (future phase)
