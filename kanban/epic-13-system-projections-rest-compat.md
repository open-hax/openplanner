---
uuid: "openplanner-system-projections-rest-compat"
title: "Epic: System Projections, Socket.IO & REST Compat Layer"
status: done
priority: P0
labels: ["epic", "projections", "socket-io", "rest-api", "mongo", "architecture"]
created_at: "2026-06-05T00:00:00Z"
category: "epic"
---

# Epic: System Projections, Socket.IO & REST Compat Layer

## Objective

Define CLJS protocols for clients to interact with types of data. Create records implementing those protocols through three transport mechanisms: Mongo change streams (server-to-server), Socket.IO (web clients), and REST API (external compat). Each system owns exactly one Mongo collection it writes to — a "projection" of the event ledger.

## Key Design Decisions

- Protocols defined in CLJS for: event admission, session management, document storage, graph operations, translation, labels
- **Three record implementations per protocol:** `MongoChangeStreamRecord`, `SocketIoRecord`, `RESTApiRecord`
- Socket.IO is the primary web client transport — its terminology maps directly:
  - Socket.IO namespaces = system domains (`auth`, `session`, `graph`)
  - Socket.IO rooms = causal/session scoping
  - Socket.IO events = the same event ledger envelope events
  - A socket connection = an actor reference (the client is an actor)
- Only REST is supported now as compatibility layer for external services
- Every system watches the ledger for event kinds it cares about
- Systems produce effects by writing to their projection collection
- Projection collections are the queryable state; the ledger is the source of truth
- **Each system is its own package under `packages/`. No new code in `src/`. No new TypeScript.**

## Dependencies

- Epic 12 (event ledger foundation)

## Verification Gate (non-negotiable)

Every task in this epic **must** pass all of the following before marking done:

1. **Automated checks:**
```bash
npx shadow-cljs compile test   # 0 failures, 0 errors
npx shadow-cljs compile lib    # 0 warnings
npx clj-kondo --lint src test  # 0 errors, 0 warnings
```

2. **Code review:** Dispatch a code review sub-agent (via `task` tool) to review all changed files. The task cannot be marked done until the reviewer returns with no critical issues.

No exceptions. If a warning exists, fix it or record it explicitly with the owning file.

## Definition of Done

- CLJS protocols defined for each system domain
- Mongo change stream record implementations working
- Socket.IO record implementations working (web clients speak the same protocol)
- REST API record implementations working as compat layer
- Each system writes to its own projection collection
- Web clients interact through Socket.IO using the same event envelope
- REST endpoints route through the same protocol interface
- Internal Knoxx calls use Mongo directly, not REST

## Tasks

| Task | Points | Depends On | Status |
|------|--------|-----------|--------|
| 13-01: CLJS protocol definitions for system domains | 5 | — | Done |
| 13-04: Projection collection ownership map | 2 | 13-01 | Done |
| 13-02: Mongo change stream record implementations | 5 | 13-01, 13-04 | Done |
| 13-03: REST API record implementations (compat) | 3 | 13-01, 13-04 | Done |
| 13-05: REST route refactor to protocol layer | 5 | 13-01, 13-04 | Done |
| 13-06: Socket.IO record implementations | 5 | 13-01, 13-04 | Done |

**Total: 25 points**
