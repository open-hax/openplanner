(fork-tax-state
  (time "2026-07-10T20:07:21Z")
  (repo "/home/err/spaces/openplanner")
  (branch "main")
  (remote "origin")
  (status "committed")
  (tag "Π/20260710T200721Z-openplanner-sdk-extraction")

  (purpose
    "Extract the OpenPlanner data-plane into a reusable workspace package (@open-hax/openplanner-sdk)."
    "Delete the knoxx and eta-mu-sol submodules (superseded by in-repo SDK)."
    "Update PRINCIPLE.edn skill-path migration from ~/.pi/agent/skills to ~/.agents/skills."
    "Add service/ deployment artifacts (compose, k8s, nginx).")

  (staged-files
    ".gitmodules"
    ".ημ/PRINCIPLE.edn"
    "package.json"
    "packages/agents/eta-mu-sol"
    "packages/agents/knoxx"
    "packages/openplanner-sdk/package.json"
    "packages/openplanner-sdk/tsconfig.json"
    "packages/openplanner-sdk/src/config.ts"
    "packages/openplanner-sdk/src/embedding-cache.ts"
    "packages/openplanner-sdk/src/embedding-models.ts"
    "packages/openplanner-sdk/src/embedding-runtime.ts"
    "packages/openplanner-sdk/src/embedding-text.ts"
    "packages/openplanner-sdk/src/embeddings.ts"
    "packages/openplanner-sdk/src/indexing.ts"
    "packages/openplanner-sdk/src/index.ts"
    "packages/openplanner-sdk/src/ingest.ts"
    "packages/openplanner-sdk/src/mongo-browse.ts"
    "packages/openplanner-sdk/src/mongodb.ts"
    "packages/openplanner-sdk/src/mongo-vectors.ts"
    "packages/openplanner-sdk/src/protocol-adapters.ts"
    "packages/openplanner-sdk/src/schema-versions.ts"
    "packages/openplanner-sdk/src/sdk.ts"
    "packages/openplanner-sdk/src/search-core.ts"
    "packages/openplanner-sdk/src/sentence-split.ts"
    "packages/openplanner-sdk/src/sessions-core.ts"
    "packages/openplanner-sdk/src/source-hydration.ts"
    "packages/openplanner-sdk/src/turndown.d.ts"
    "packages/openplanner-sdk/src/types.ts"
    "packages/openplanner-sdk/src/vector-search.ts"
    "pnpm-lock.yaml"
    "service/"
    "src/lib/config.ts"
    "src/lib/embedding-cache.ts"
    "src/lib/embedding-models.ts"
    "src/lib/embedding-runtime.ts"
    "src/lib/embedding-text.ts"
    "src/lib/embeddings.ts"
    "src/lib/indexing.ts"
    "src/lib/mongodb.ts"
    "src/lib/mongo-vectors.ts"
    "src/lib/protocol-adapters.ts"
    "src/lib/schema-versions.ts"
    "src/lib/sentence-split.ts"
    "src/lib/source-hydration.ts"
    "src/lib/types.ts"
    "src/lib/vector-search.ts"
    "src/routes/v1/events.ts"
    "src/routes/v1/mongo.ts"
    "src/routes/v1/search.ts"
    "src/routes/v1/sessions.ts"
    "src/types/turndown.d.ts")

  (concurrent-dirt
    (entry
      (path "service/.env")
      (status "ignored-local-env")
      (action "left-untracked"))
    (entry
      (path "service/runtime-secrets/")
      (status "ignored-local-secrets")
      (action "left-untracked"))
    (entry
      (path "service/openplanner-lake/")
      (status "ignored-runtime-data")
      (action "left-untracked"))
    (entry
      (path "service/openplanner-proxx-data/")
      (status "ignored-runtime-data")
      (action "left-untracked"))
    (entry
      (path "packages/openplanner-sdk/dist/")
      (status "ignored-build-output")
      (action "left-untracked")))

  (verification
    (tool "pnpm-install")
    (result "success"))
  (verification
    (tool "pnpm-filter-@open-hax/openplanner-sdk-build")
    (result "success"))
  (verification
    (tool "tsc-noEmit-root")
    (result "success"))
  (verification
    (tool "eslint-scoped-packages-openplanner-sdk-src-and-src-lib")
    (result "pre-existing-warnings-1903-zero-errors"))

  (handoff-artifacts
    ".ημ/Π_LAST.md"
    ".ημ/Π_STATE.sexp"
    ".ημ/Π_MANIFEST.sha256"))
