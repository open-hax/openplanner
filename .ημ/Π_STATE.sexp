(fork-tax-state
  (time "2026-06-14T03:09:30Z")
  (repo "/home/err/devel/orgs/open-hax/openplanner")
  (branch "fix/kanban-event-ledger-edn-admission")
  (remote "origin")
  (status "ready-to-commit")

  (staged-files
    "packages/axxium/src/cljs/axxium/auth/session.cljs"
    "packages/axxium/src/cljs/axxium/config.cljs"
    "packages/axxium/src/cljs/axxium/routes/actor.cljs"
    "packages/event-ledger/src/promethean/event_ledger/watcher.cljs"
    "packages/openplanner-protocols/src/promethean/records/edn/event_admission.cljs"
    "packages/openplanner-protocols/src/promethean/records/mongo/user_management.cljs"
    "packages/services/graphics-svg-pipeline/src/cljs/graphics_svg_pipeline/mcp_server.cljs"
    "packages/services/graphics-svg-pipeline/src/cljs/graphics_svg_pipeline/notifier.cljs"
    "packages/services/graphics-svg-pipeline/src/cljs/graphics_svg_pipeline/renderer.cljs"
    "packages/services/graphics-svg-pipeline/src/cljs/graphics_svg_pipeline/validator.cljs"
    "packages/services/graphics-svg-pipeline/src/cljs/graphics_svg_pipeline/watcher.cljs"
    "packages/services/graphics-svg-pipeline/test/cljs/graphics_svg_pipeline/ledger_test.cljs"
    "scripts/typescript-inventory-allowlist.json"
    "src/lib/protocol-adapters.ts"
    "receipts.edn")

  (concurrent-dirt
    (entry
      (path "packages/agents/eta-mu-sol/")
      (status "untracked-new-project")
      (action "left-untouched"))
    (entry
      (path "packages/agents/opencode")
      (status "stale-untracked-entry")
      (action "left-untouched")))

  (verification
    (tool "manual-review")
    (result "19 review comments resolved; CI re-run pending"))

  (handoff-artifacts
    ".ημ/Π_LAST.md"
    ".ημ/Π_STATE.sexp"
    ".ημ/Π_MANIFEST.sha256"))
