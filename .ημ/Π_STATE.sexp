(fork-tax-state
  (repo "openplanner")
  (branch "tests/sentance-chunker")
  (base "0bec078ba6bab19df9e973f65f6b48d52c835234")
  (timestamp "2026-05-16T03:58:00Z")
  (knoxx-submodule "094273c3")
  (scope "graph-pressure-relief projection-cache metrics kafka-redpanda clojure-workers")
  (verification
    "pnpm exec tsc --noEmit passed"
    "clojure -M:check passed"
    "docker compose --profile kafka --profile kafka-replay config --quiet passed"
    "audit consumer heartbeat observed"
    "dry-run replay processed 5 messages"
    "bounded non-dry-run replay [0,1) idempotent")
  (residual
    "packages/agents/knoxx has intentionally unabsorbed residual dirt inside the submodule"))
