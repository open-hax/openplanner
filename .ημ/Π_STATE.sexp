(Π-state
  (repo "openplanner")
  (branch "main")
  (timestamp "2026-04-17T23:50:00Z")
  (mode :recursive-fork-tax)
  (summary
    "Monorepo restructuring: removed all git submodules, reorganized packages into category dirs (agents/, graph/, signals/, archive/, pseudo/), updated pnpm-workspace.yaml, added new packages (agents/knoxx with full CLJS backend+TS frontend, graph/* with graph-weaver/ACO/myrmex/webgl/eros-eris-field, signals/signal-contracts/signal-radar-core/sintel), archived retired packages (embedding, event, persistence, reconstituter, semantic-graph-builder), removed .gitmodules, updated .gitignore for CLJS/Vite/LevelDB artifacts.")
  (structure
    (packages/agents
      "knoxx (full stack: CLJS backend, TS frontend, discord-bot, ingestion, voice)"
      "personality-system (CLJS)"
      "circuits-octave (CLJS)")
    (packages/graph
      "graph-weaver (TS)"
      "graph-weaver-aco (TS)"
      "myrmex (TS)"
      "webgl-graph-view (TS)"
      "eros-eris-field (TS)"
      "eros-eris-field-app (TS)")
    (packages/signals
      "signal-contracts (CJS)"
      "signal-radar-core (CJS)"
      "sintel (TS)")
    (packages/vexx "submodule - still active")
    (archive "retired: embedding, event, persistence, reconstituter, semantic-graph-builder")
    (pseudo "experimental: workbench, clients, graph-runtime, janus, mcp-fs-oauth, openplanner-cljs-client, opencode-openplanner-plugin-cljs"))
  (deleted-submodules
    "packages/cephalon -> packages/agents/cephalon (embedded)"
    "packages/clients -> pseudo/clients (embedded)"
    "packages/eros-eris-field -> packages/graph/eros-eris-field (embedded)"
    "packages/eros-eris-field-app -> packages/graph/eros-eris-field-app (embedded)"
    "packages/graph-runtime -> pseudo/graph-runtime (embedded)"
    "packages/graph-weaver -> packages/graph/graph-weaver (embedded)"
    "packages/graph-weaver-aco -> packages/graph/graph-weaver-aco (embedded)"
    "packages/janus -> pseudo/janus (embedded)"
    "packages/knoxx -> packages/agents/knoxx (embedded)"
    "packages/mcp-fs-oauth -> pseudo/mcp-fs-oauth (embedded)"
    "packages/myrmex -> packages/graph/myrmex (embedded)"
    "packages/opencode-openplanner-plugin-cljs -> pseudo/opencode-openplanner-plugin-cljs (embedded)"
    "packages/openplanner-cljs-client -> pseudo/openplanner-cljs-client (embedded)"
    "packages/reconstituter -> archive/reconstituter (embedded)"
    "packages/workbench -> pseudo/workbench (embedded)")
  (concurrent-dirt "none observed"))
