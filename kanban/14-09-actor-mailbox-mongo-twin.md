---
uuid: "openplanner-14-09-actor-mailbox-mongo-twin"
title: "14-09: Actor Mailbox → Mongo Twin"
status: proposed
priority: P2
labels: ["tasks", "2sp", "knoxx", "mongo", "mailbox", "follow-up"]
created_at: "2026-06-06T00:00:00Z"
category: "tasks"
---

# 14-09: Actor Mailbox → Mongo Twin

**Epic:** 14 — Knoxx Redis/SQL → Mongo Migration (post-gate follow-up)
**Depends on:** 14-05

## Description

`actor_mailbox_routes` and `actor_mailbox_entries` were never part of the
14-04 19-table inventory, so they have no Mongo twin. Since the 14-05 PG
removal, `domain/actor/mailbox.cljs` honestly disables durable persistence:
`database-enabled?` requires an executable `:query!` on the policy context
(the Mongo context has none), so mailbox entries flow live with
`:mailbox/durable? false` and are lost on restart.

Restore durable mailbox persistence with a Mongo twin.

## Acceptance Criteria

- `infra/stores/mongo_mailbox.cljs` twin: `knoxx_mailbox_routes` (unique index
  on `actor_id`, TTL on `expires_at`) + `knoxx_mailbox_entries` (index on
  `target_actor_id`+`status`, TTL on `expires_at`)
- `domain/actor/mailbox.cljs` routes its ~6 SQL shapes through the twin;
  `database-enabled?` true on the Mongo context again
- `policy-db/query!` stub loses its last production caller — delete it if
  the actor-mailbox test mock is migrated too
- Entries marked `:mailbox/durable? true` again when Mongo is up

## Verification (non-negotiable)

1. `pnpm exec shadow-cljs compile test` — 0 failures, 0 errors
2. `pnpm exec shadow-cljs compile server` — 0 warnings
3. `clj-kondo --lint src test` — no new errors
4. **Code review:** sub-agent review, no critical issues
