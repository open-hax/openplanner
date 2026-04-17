# Package Decomposition Phase 0 — Establish CLJS as Canonical

**Parent:** `package-decomposition-roadmap.md`
**Story Points:** 3
**Status:** done

## Goal

Establish CLJS ECS as the canonical agent runtime and document it as the reference implementation before beginning decomposition.

## Scope

### In Scope
- Audit CLJS feature parity against TS runtime
- Document CLJS ECS architecture as reference
- Mark `cephalon-ts` as deprecated in README

### Out of Scope
- Actual package decomposition
- TS retirement
- Code migration

## Tasks

- [x] Audit CLJS `sys/*` against TS `sessions/manager.ts` and `llm/turn-processor.ts` for feature gaps
  - Result: `specs/cljs-ts-feature-parity-audit.md`
- [x] Document CLJS ECS architecture in `packages/cephalon-cljs/README.md`
- [x] Add deprecation notice to `packages/cephalon-ts/README.md`
- [x] Update root README to indicate CLJS is canonical

## Acceptance Criteria

- [x] CLJS README documents ECS architecture with diagrams
- [x] Feature parity audit is documented (gaps listed or "full parity" confirmed)
- [x] TS README has deprecation notice with migration guidance
- [x] Root README indicates CLJS is the canonical implementation

## Dependencies

None (this is the first phase).

## Blocking

- Blocks all later decomposition phases (they assume CLJS is canonical)
