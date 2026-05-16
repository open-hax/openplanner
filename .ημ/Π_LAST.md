# Π Fork Tax Snapshot — OpenPlanner

- Timestamp: 2026-05-16T03:58:00Z
- Branch: tests/sentance-chunker
- Base: 0bec078ba6bab19df9e973f65f6b48d52c835234
- Knoxx submodule target: 094273c3 (`pi/fork-tax/20260516-knoxx-094273c3`)
- Scope: graph pressure relief, projection cache, Prometheus metrics, Kafka/Redpanda event spine, and JVM Clojure workers.

## Included work

- Bounded graph-weaver/OpenPlanner graph workload pressure.
- Extracted generic cache package under `packages/stores/cache` and kept document hydration as a compatibility facade.
- Added graph export/view projection caching with fail-open degraded graph-view responses.
- Added Prometheus text metrics at `/v1/metrics` and shallow default health checks with Kafka status.
- Added optional Kafka publisher shim from the TypeScript API into `openplanner.events.raw`.
- Added actual Clojure Kafka worker package for audit/replay/check jobs.
- Pinned Knoxx submodule to the pushed fork-tax receipt commit.

## Verification

- `pnpm --filter @open-hax/openplanner-store-cache build` passed earlier in the trail.
- `pnpm exec tsc --noEmit` passed.
- `clojure -M:check` passed in `packages/workers/kafka`.
- `docker compose --profile kafka --profile kafka-replay config --quiet` passed from `services/openplanner`.
- Clojure worker image build passed.
- Audit consumer logged connected heartbeat.
- Dry-run replay processed 5 messages.
- Bounded non-dry-run replay `[0,1)` processed 1 event twice without duplicate-key failure.
- `/v1/health` and `/v1/metrics` Kafka checks passed.

## Residual dirt intentionally not absorbed

- `packages/agents/knoxx` still has untracked/modified residual files inside the submodule that were explicitly left out of the Knoxx fork-tax commit: `docs/actor-realtime-socket-io-spec.md`, `voice/stt-npu/server.py`, and `uploads/openutau/the-frame-of-absence/`.

No destructive cleanup was performed.
