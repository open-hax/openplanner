# archive/

Frozen and legacy code. Preserved for reference and historical context.

Packages here are **excluded from `pnpm -r build` and `pnpm -r test`** by default,
unless explicitly listed in `pnpm-workspace.yaml` because they are still depended on
by active packages.

## What belongs here

- Deprecated services superseded by newer implementations
- Legacy code kept for data migration or reference
- Packages that no longer run independently

## What does NOT belong here

- Active production code
  → move to `packages/`
- Scratch/experimental code
  → move to `pseudo/`

## Current contents

| Directory | Status | Notes |
|-----------|--------|-------|
| `embedding/` | frozen | Legacy embedding service |
| `event/` | **workspace dep** | Used by `packages/agents/cephalon-ts` |
| `persistence/` | frozen | Legacy persistence layer |
| `reconstituter/` | frozen | Session reconstitution |
| `semantic-graph-builder/` | frozen | Legacy graph builder |

**Workspace dep** = listed in `pnpm-workspace.yaml`, participates in builds.
