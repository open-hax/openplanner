---
uuid: "openplanner-ledger-adoption"
title: "Epic: Ledger Adoption — Platform Packages on the Event Ledger"
status: incoming
priority: P2
labels: ["epic", "knoxx", "event-ledger", "protocols", "socket-io", "integration"]
created_at: "2026-06-06T00:00:00Z"
category: "epic"
---

# Epic 22: Ledger Adoption — Platform Packages on the Event Ledger

## Objective

The behavioral half that extraction deliberately deferred: the decomposed platform
packages adopt `event-ledger` + `openplanner-protocols`. Stores become projections
watched from the ledger; the runtime emits lifecycle events; route modules and the
frontend speak the Socket.IO protocol records from E13.

This epic **merges with event-ledger roadmap M5 (Integration & Retirement)** — by the
time the packages exist, "all systems project from the ledger" and "packages speak the
ledger" are the same work.

## Why this is a separate epic

The decomposition program (E16–E21) is structural: every move preserves behavior and is
verified by the existing suite. Wiring onto the ledger is a behavior change. Keeping them
separate means each extraction was cheap to verify, and this epic gets to be a focused
architecture change on already-clean seams.

## Expected work (not yet broken down — grounded when E21 nears)

- `agent-stores`: writes become events appended to the ledger; collections become
  projections maintained by change-stream watchers (E12/E13 infrastructure)
- `agent-runtime`: turn/run lifecycle emits ledger events (run started, turn completed,
  recovery), consumable by any watcher
- `policy-engine`: audit log becomes ledger-projected; user lifecycle integrates with
  E15's auth watcher
- Route modules: REST stays compat-only (`RESTApiRecord`); Socket.IO records become
  the primary client transport
- Knoxx frontend consumes `@open-hax/openplanner-client`
- Monitoring: event throughput, projection lag, watcher health (from M5 scope)

## Dependencies

- Epic 21 (distribution composition root)
- Event-ledger roadmap M4 (E15 auth lifecycle) landed
- Coordinates with / absorbs event-ledger roadmap M5

## Definition of Done (provisional)

- Every platform package that persists state does so as ledger projections
- Socket.IO is the primary transport for the Knoxx frontend
- REST is compat-only
- Event-ledger roadmap M5 exit criteria satisfied

**Points: TBD — broken down when E21 nears**
