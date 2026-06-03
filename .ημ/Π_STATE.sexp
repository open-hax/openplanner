(handoff
  (kind fork-tax)
  (time "2026-06-03T20:34:00Z")
  (repo "openplanner")
  (branch "pi/fork-tax/20260529T022118Z-main-softreset-all-dirt-openplanner")
  (base "origin/staging")
  (tag "Π/20260603T203400Z-openplanner-ts-gate-deploy-workflows")
  (commits
    (ts-cljs-gate "scripts/check-no-new-typescript.mjs + 756-entry allowlist + code-quality job + roadmap/inventory docs + kanban epic/tasks")
    (labels-fix "labels.ts: reaction labels persisted to vector labels set, expiresAt unset, quality_label optional")
    (deploy-workflows "deploy-staging/production/testing via open-hax/services deploy-promethean.yml@main; testing is label-gated PR-head -> shared staging slot")
    (pi-process "receipts +8, board snapshots, knoxx submodule pointer -> 58629bd1 (pushed), .ημ artifacts")
    (staging-merge "origin/staging merged; staging's no-recursive-submodule deploy fixes kept (file:/// submodule breaks runners)"))
  (constraints
    "check:no-new-typescript needs knoxx submodule present; code-quality job inits GitHub-hosted submodules explicitly, never file:///"
    "pull_request_target runs base-branch workflow defs; deploy-testing activates after merge to staging")
  (verification
    (no-new-ts "pass local 756/756 with submodules")
    (actionlint "clean: deploy-testing/staging/production")
    (ci "build/test deferred to PR staging-preflight gates"))
  (concurrent-dirt "none at snapshot time")
  (destructive-cleanup false))
