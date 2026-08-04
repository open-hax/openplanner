---
uuid: "openplanner-event-ledger-roadmap"
title: "Event Ledger Architecture Roadmap"
status: incoming
priority: P0
labels: ["roadmap", "event-ledger", "architecture", "mongo", "socket-io"]
created_at: "2026-06-05T00:00:00Z"
category: "specs"
---

# Event Ledger Architecture Roadmap

Date: 2026-06-05
Status: proposed

## Purpose

Transition OpenPlanner from a REST-API-with-attached-state model to an event-ledger architecture. Every action enters through a Mongo event ledger. Systems watch the ledger and produce effects in their own projection collections. Web clients speak Socket.IO using the same event protocol.

## Architecture rules

1. All data enters through events
2. Systems own projection collections, not raw state
3. Events default TTL: 1 month — anything persisted must be projected
4. `packages/` only — no new TypeScript, `src/` is dead for new work
5. Socket.IO is the primary web transport
6. REST is a thin compat layer for external services
7. No Redis, no PostgreSQL — Mongo only
8. Kafka shelved — change streams are the distribution mechanism

## Program shape

```
E12: Ledger         ─── E13: Protocols + Transports ─── E14: Knoxx Migration
(foundational)         (abstraction layer)              (concrete stores)
                          │
                          ├── Mongo change stream records
                          ├── Socket.IO records (web clients)
                          └── REST records (external compat)
                          │
                     E15: Auth Lifecycle
                     (first end-to-end proof)
```

## Milestones

| Phase | Epic | Name | Points | Status | Exit signal |
|-------|------|------|--------|--------|-------------|
| M1 | 12 | Ledger exists | 24 | ✅ done | Events append to `event_ledger`, change streams work, REST writes to ledger |
| M2 | 13 | Protocol layer | 25 | ✅ done | CLJS protocols defined, three record implementations working, routes delegate to protocols |
| M3 | 14 | Knoxx Mongo | 43 | ✅ done (2026-06-06) | Redis gone, PG gone, all Knoxx state in Mongo |
| M4 | 15 | Auth lifecycle | 23 | ⬜ proposed, unblocked — reconcile session collections before 15-02 | Signup + login work end-to-end through event ledger, Socket.IO primary path |
| M5 | — | Integration | — | ⬜ not broken down | All systems project from ledger, REST retired, web clients use Socket.IO exclusively |

**Total: 117 points** (115 + 14-09 mailbox-twin follow-up discovered during 14-05)

## Dependency graph

```
E12 (Ledger)
 ├── E13 (Protocols) ─── E15 (Auth)
 │    │
 │    └── E14 (Knoxx) ──→ can start after E13
 │
 └── E15 (Auth) ──→ needs E12 + E13
```

E14 and E15 can run in parallel after E13 lands.

---

## Phase M1 — Event Ledger Foundation (E12)

**Goal:** The ledger exists. Events go in, change streams come out.

**Tasks:**
- 12-01: `event_ledger` Mongo collection + schema (5)
- 12-02: Envelope validation + append primitive (5)
- 12-03: Change stream watcher infrastructure (5)
- 12-04: REST compatibility adapter (3)
- 12-05: Event TTL + archival policy (3)
- 12-06: Legacy events collection bridge (3)

**Deliverables:**
- `packages/event-ledger/` — new CLJS package
- `event_ledger` collection with TTL, unique index on `event/id`, indexes on `event/type`, `causal/root`, `session/id`
- `appendEvent` validates envelope, assigns `ledger/seq` server-side
- `watchLedger(filter, callback)` opens Mongo change stream
- `POST /events` writes to ledger (feature flag toggle)
- Legacy `events` collection remains readable

**Gate to M2:** Events append to the ledger. Change streams fire on new events. REST endpoint writes to ledger without breaking existing clients.

---

## Phase M2 — Protocols & Transports (E13)

**Goal:** The abstraction layer. CLJS protocols define how clients talk to systems. Three record implementations: Mongo, Socket.IO, REST.

**Tasks:**
- 13-01: CLJS protocol definitions for system domains (5)
- 13-02: Mongo change stream record implementations (5)
- 13-03: REST API record implementations — compat (3)
- 13-04: Projection collection ownership map (2)
- 13-05: REST route refactor to protocol layer (5)
- 13-06: Socket.IO record implementations (5)

**Deliverables:**
- `packages/openplanner-protocols/` — shared CLJS protocol definitions
- `packages/openplanner-client/` — thin Socket.IO client library for web
- 7 protocols: EventAdmission, SessionManagement, DocumentStorage, GraphOperations, TranslationManagement, LabelManagement, UserManagement, RealtimeSubscription
- `MongoChangeStreamRecord` — server-to-server via change streams
- `SocketIoRecord` — web clients via Socket.IO namespaces/rooms
- `RESTApiRecord` — external services via HTTP
- Projection ownership map: which system watches what, owns which collection
- REST routes delegate to protocols (no direct `app.mongo.*`)

**Gate to M3/M4:** Protocols defined. All three transports working. Web client can connect via Socket.IO and emit/query events. REST routes delegate to protocol layer.

---

## Phase M3 — Knoxx Redis/SQL → Mongo (E14)

**Goal:** Redis and PostgreSQL are gone. All Knoxx state in Mongo.

**Tasks:**
- 14-01: Knoxx session store → Mongo collection (8)
- 14-02: Knoxx run store + run events → Mongo (5)
- 14-03: Knoxx composite store → Mongo-only (3)
- 14-04: Policy DB tables (19) → Mongo collections (8)
- 14-07: Additional Redis key patterns → Mongo (10)
- 14-08: System instance orphan reclaim (2)
- 14-05: Remove Redis + PG dependencies from Knoxx (5)
- 14-06: Drop hydration Redis cache layer (2)
- 14-09: Actor mailbox → Mongo twin (2) — post-gate follow-up, proposed

**Deliverables:**
- `knoxx_sessions` collection (replaces `knoxx:session:{id}` Redis keys)
- `knoxx_runs` collection (replaces `knoxx:run:{id}` Redis keys)
- `knoxx_orgs`, `knoxx_users`, `knoxx_memberships`, `knoxx_roles`, `knoxx_invites`, `knoxx_audit_log`, `knoxx_config` collections (replace PG tables)
- Redis client deleted from Knoxx backend
- PG client deleted from Knoxx backend
- Hydration cache: in-memory LRU + LMDB only

**Gate to M5:** Knoxx runs entirely on Mongo. `redis` and `pg` packages removed from `knoxx/backend/package.json`.

**Gate passed 2026-06-06.** Notes: 14-05 absorbed the unfinished 14-04 dispatch
(directory/roles/tools slices were twinned but never wired). Pre-cutover PG auth
sessions are invalidated — accepted. Durable actor-mailbox persistence is
disabled pending 14-09 (entries flow live, non-durable).

---

## Phase M4 — Event-Driven Auth & User Lifecycle (E15)

**Goal:** First end-to-end proof of the architecture. Signup and login work through the event ledger with Socket.IO as the primary path.

**Tasks:**
- 15-01: User lifecycle event type definitions (2)
- 15-02: Auth system watcher for user events (8)
- 15-03: Temporary watcher infrastructure (5)
- 15-04: Signup flow — event → watcher → response (5)
- 15-05: Login flow via same event pattern (3)

**Deliverables:**
- `packages/auth-system/` — CLJS package, watches `user.*.request` events
- `packages/event-ledger/` — temporary watcher (Socket.IO rooms + HTTP change stream fallback)
- 21 event types: `user.create/update/delete/login/logout/password-change/status-change.*`
- Signup via Socket.IO: client emits `user.create.request`, gets `user.create.success` back on same socket
- Signup via HTTP: POST, temporary watcher, 201 response
- Login via Socket.IO: same pattern with `user.login.*` events
- Auth watcher creates users in `knoxx_users`, login sessions in `auth_sessions` (separate from `knoxx_sessions`)
  - ⚠️ Reconcile before 15-02: 14-04 already created `knoxx_policy_sessions` for
    cookie auth sessions — decide whether E15's `auth_sessions` replaces it,
    projects into it, or is a genuinely separate collection.

**Gate to M5:** User can sign up and log in through the event ledger. Socket.IO is the primary path. HTTP works as compat.

---

## Phase M5 — Integration & Retirement

**Goal:** All systems project from the ledger. REST API is retired for internal use. Web clients use Socket.IO exclusively.

**Not yet broken down into tasks** — depends on M1–M4 landing first.

Expected work:
- Remaining REST routes retired or moved to Socket.IO
- `src/` TypeScript fully retired (per existing TypeScript retirement epic)
- All systems watching ledger and writing to projection collections
- Monitoring: event throughput, projection lag, watcher health
- Documentation: architecture guide, protocol reference, client SDK docs

---

## Visualization

```
Week 1-2     Week 3-4     Week 5-6     Week 7-8     Week 9+
─────────────────────────────────────────────────────────────
M1: E12 ──────────────────┐
  Ledger foundation        │
                           ├──→ M2: E13 ──────────────────┐
                           │    Protocols + Transports      │
                           │    │                           │
                           │    ├──→ M3: E14 (parallel) ──→│
                           │    │    Knoxx Mongo            │
                           │    │                           │
                           │    └──→ M4: E15 (parallel) ──→│
                           │         Auth lifecycle         │
                           │                                │
                           └────────────────────────────────┘
                                                 │
                                                 ↓
                                          M5: Integration
                                          All systems on ledger
```

## What this roadmap says explicitly

1. The ledger is the foundation — everything else sits on top
2. Protocols are the abstraction — transports are just record implementations
3. Socket.IO is not an afterthought — it's a first-class transport alongside Mongo and REST
4. Knoxx Redis/SQL migration is independent of auth lifecycle — they can run in parallel
5. Auth lifecycle is the proof — if signup/login work end-to-end, the architecture is valid
6. `src/` dies incrementally — REST routes are thin shells that get replaced by Socket.IO
7. 115 points total — at 5 points/day, this is ~23 working days
