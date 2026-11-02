# Π handoff — OpenPlanner SDK extraction

- time: 2026-07-10T20:07:21Z
- branch: `main`
- remote: `origin` (git@github.com:open-hax/openplanner.git)
- tag: `Π/20260710T200721Z-openplanner-sdk-extraction`

## What is in this Π

1. Extract the OpenPlanner data-plane into a new workspace package `@open-hax/openplanner-sdk`.
   - Source files moved from `src/lib/*` and `src/types/turndown.d.ts` to `packages/openplanner-sdk/src/*`.
   - Old `src/lib/*` paths become thin shims that re-export from the SDK package so existing app imports stay stable.
   - New SDK entrypoints: `sdk.ts`, `index.ts`, `ingest.ts`, `search-core.ts`, `sessions-core.ts`, `mongo-browse.ts`.
2. Remove the `packages/agents/eta-mu-sol` and `packages/agents/knoxx` submodules.
   - Their commit pointers (gitlinks) are deleted; `knoxx` entry is removed from `.gitmodules`.
   - `eta-mu-sol` was already absent from `.gitmodules` in HEAD.
3. Update `.ημ/PRINCIPLE.edn` skill registry paths from `~/.pi/agent/skills` to `~/.agents/skills`.
4. Add `service/` deployment infrastructure (Docker Compose, k8s manifests, nginx configs, READMEs).
5. Refactor `src/routes/v1/events.ts`, `mongo.ts`, `search.ts`, `sessions.ts` to delegate to the SDK.
6. Update root `package.json` and `pnpm-lock.yaml` to include the SDK workspace dependency.

## Files changed

### Git metadata
- `.gitmodules`
- `.ημ/PRINCIPLE.edn`

### Workspace manifests
- `package.json`
- `pnpm-lock.yaml`
- `packages/openplanner-sdk/package.json`
- `packages/openplanner-sdk/tsconfig.json`

### Moved to SDK (with re-export shims left behind)
- `src/lib/config.ts` → `packages/openplanner-sdk/src/config.ts`
- `src/lib/embedding-cache.ts` → `packages/openplanner-sdk/src/embedding-cache.ts`
- `src/lib/embedding-models.ts` → `packages/openplanner-sdk/src/embedding-models.ts`
- `src/lib/embedding-runtime.ts` → `packages/openplanner-sdk/src/embedding-runtime.ts`
- `src/lib/embedding-text.ts` → `packages/openplanner-sdk/src/embedding-text.ts`
- `src/lib/embeddings.ts` → `packages/openplanner-sdk/src/embeddings.ts`
- `src/lib/indexing.ts` → `packages/openplanner-sdk/src/indexing.ts`
- `src/lib/mongodb.ts` → `packages/openplanner-sdk/src/mongodb.ts`
- `src/lib/mongo-vectors.ts` → `packages/openplanner-sdk/src/mongo-vectors.ts`
- `src/lib/protocol-adapters.ts` → `packages/openplanner-sdk/src/protocol-adapters.ts`
- `src/lib/schema-versions.ts` → `packages/openplanner-sdk/src/schema-versions.ts`
- `src/lib/sentence-split.ts` → `packages/openplanner-sdk/src/sentence-split.ts`
- `src/lib/source-hydration.ts` → `packages/openplanner-sdk/src/source-hydration.ts`
- `src/lib/types.ts` → `packages/openplanner-sdk/src/types.ts`
- `src/lib/vector-search.ts` → `packages/openplanner-sdk/src/vector-search.ts`
- `src/types/turndown.d.ts` → `packages/openplanner-sdk/src/turndown.d.ts`

### New SDK files
- `packages/openplanner-sdk/src/index.ts`
- `packages/openplanner-sdk/src/ingest.ts`
- `packages/openplanner-sdk/src/mongo-browse.ts`
- `packages/openplanner-sdk/src/sdk.ts`
- `packages/openplanner-sdk/src/search-core.ts`
- `packages/openplanner-sdk/src/sessions-core.ts`

### New shim files (re-export from SDK)
- `src/lib/config.ts`
- `src/lib/embedding-cache.ts`
- `src/lib/embedding-models.ts`
- `src/lib/embedding-runtime.ts`
- `src/lib/embedding-text.ts`
- `src/lib/embeddings.ts`
- `src/lib/indexing.ts`
- `src/lib/mongodb.ts`
- `src/lib/mongo-vectors.ts`
- `src/lib/protocol-adapters.ts`
- `src/lib/schema-versions.ts`
- `src/lib/sentence-split.ts`
- `src/lib/source-hydration.ts`
- `src/lib/types.ts`
- `src/lib/vector-search.ts`

### Refactored routes
- `src/routes/v1/events.ts`
- `src/routes/v1/mongo.ts`
- `src/routes/v1/search.ts`
- `src/routes/v1/sessions.ts`

### Deleted submodules
- `packages/agents/eta-mu-sol`
- `packages/agents/knoxx`

### Added deployment/service directory
- `service/`

## Verification

- `pnpm install` — success.
- `pnpm --filter @open-hax/openplanner-sdk build` — success.
- `npx tsc --noEmit` at root — success.
- `npx eslint --config eslint.config.mjs packages/openplanner-sdk/src src/lib --max-warnings=0` — 0 errors, 1903 pre-existing warnings (the moved files retain their original warnings; shims are clean). Lint did not pass the zero-warnings gate because of legacy code style.

## Concurrent dirt left untouched

Local-only / secret / runtime artifacts are intentionally excluded by `service/.gitignore` and were not staged:

- `service/.env`
- `service/runtime-secrets/`
- `service/openplanner-lake/`
- `service/openplanner-proxx-data/`
- `packages/openplanner-sdk/dist/` (build output, ignored by root `dist/` rule)

If these need to travel with a future handoff, redact them first.
