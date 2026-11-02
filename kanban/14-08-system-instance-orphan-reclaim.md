---
uuid: "openplanner-14-08-system-instance-orphan-reclaim"
title: "14-08: System Instance ID — Orphaned Run Detection & Reclaim"
status: done
priority: P1
labels: ["tasks", "2sp", "knoxx", "mongo", "migration", "recovery", "system-instance"]
created_at: "2026-06-06T18:45:00Z"
category: "tasks"
---

# 14-08: System Instance ID — Orphaned Run Detection & Reclaim

**Epic:** 14 — Knoxx Redis/SQL → Mongo Migration

## Problem

With sessions/runs persisted in Mongo (14-01..03), a `status: "running"`
document survives process restarts — but the run it describes does not.
Background trigger dispatches (Discord event agents) then bounce off the
corpse with `agent_already_processing` until the 10-minute stale reaper
fires. Observed live 2026-06-06: `ussyverse_social_replies_event` bounced
for 10 minutes against a session whose run died silently.

## Design (operator-specified)

Every boot mints a **system instance ID** (UUID, `defonce` — survives
shadow-cljs hot reloads, changes on real restart). Stores stamp it into
every session/run document (`system_instance_id`). Ownership is then a
deterministic comparison, not a staleness guess:

- **Dispatch gate** (`runner.cljs`): doc running + stamped by another
  instance → that process is gone, reclaim (mark failed) and dispatch.
  Doc running + this instance + no live run in-process (agent-session /
  turn-control registries) + doc cold ≥60s → run died silently, reclaim
  and dispatch.
- **Bootstrap** (`resume.cljs`): startup scan aborts (auto-resume off) or
  resumes (auto-resume on) instance-orphaned sessions immediately — no
  staleness wait. Periodic recovery applies the same partition each tick.
- Legacy docs without the field are never owned → reclaimed on first touch.
- Single-writer assumption documented; multi-instance sharing requires a
  heartbeat dimension (future card if ever needed).

## Files

- `backend/src/cljs/knoxx/backend/infra/system_instance.cljs` (new)
- `backend/src/cljs/knoxx/backend/infra/stores/mongo_session_store.cljs` (stamp on put)
- `backend/src/cljs/knoxx/backend/infra/stores/mongo_run_store.cljs` (stamp on insert/update)
- `backend/src/cljs/knoxx/backend/infra/agent/runner.cljs` (dispatch-time reclaim)
- `backend/src/cljs/knoxx/backend/infra/agent/resume.cljs` (bootstrap/periodic ownership partition)
- Tests: `system_instance_test.cljs` (new), `mongo_session_store_test.cljs` (stamping)

## Verification

- `pnpm -C backend test`: 553 tests / 1603 assertions, 0 failures, 0 errors
- `pnpm -C backend typecheck` (server build): 0 warnings
- clj-kondo: no new warnings (pre-existing baseline recorded:
  `normalize-agent-spec` 58L, `queue-turn!` promise chains,
  `resume-on-process-startup!` 33L, `start-periodic-recovery!` .catch)
- Hot-reloaded into the live backend via shadow-cljs watch (no PM2 restart)

## Follow-ups

- Normalize `updated_at` type in the shared protocol (currently mixed
  epoch-ms / ISO string across writers) — belongs with 13-01.
- openplanner logs its Mongo URI with credentials in cleartext on connect;
  redact, then rotate the app credential (trivial via
  `services/openplanner/scripts/unfragile-mongo-reset.sh`).
