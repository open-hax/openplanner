# Π handoff — TS→CLJS gate, labels fix, services deploy workflows (openplanner)

- time: 2026-06-03T20:34:00Z
- branch: `pi/fork-tax/20260529T022118Z-main-softreset-all-dirt-openplanner`
- base target: `origin/staging`
- tag: `Π/20260603T203400Z-openplanner-ts-gate-deploy-workflows`

## Commits in this Π

1. `feat: TS-to-CLJS migration roadmap + no-new-TypeScript inventory gate`
   — scripts/check-no-new-typescript.mjs + 756-entry allowlist, code-quality
   job, docs/architecture roadmap + inventory, kanban epic/tasks.
2. `fix(labels): persist reaction labels on vectors and clear TTL expiry`
3. `ci: deploy workflows via open-hax/services module` — deploy-staging,
   deploy-production, and label-gated deploy-testing (PR head → shared
   staging slot via deploy-promethean.yml@main, service: openplanner).
4. Π process commit — receipts.edn (+8), kanban board snapshots, knoxx
   submodule pointer → 58629bd1 (pushed on open-hax/knoxx
   test/coverage-improvement), .ημ artifacts.
5. Merge of `origin/staging` (its deploy-workflow fixes supersede the local
   stale copies: no recursive submodule checkout on runners — the
   `file:///` openplanner-migration-tools submodule breaks it —
   `checkout_submodules: false` for the service module).

## Known constraints

- `check:no-new-typescript` requires the knoxx submodule checked out
  (allowlist entries beneath it go stale otherwise); the code-quality job
  inits GitHub-hosted submodules explicitly, never the `file:///` one.
- `pull_request_target` workflows execute from the base branch:
  deploy-testing.yml activates for labeled PRs only after this merges to
  staging.

## Verification

- `node scripts/check-no-new-typescript.mjs` → pass (756/756, local with submodules)
- `actionlint` deploy-testing/staging/production → clean
- build/test run in PR CI (staging-preflight gates)

## Concurrent dirt left untouched

- none in this repo at snapshot time
