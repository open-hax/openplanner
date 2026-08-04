---
uuid: "openplanner-13-06-socket-io-record-implementations"
title: "13-06: Socket.IO Record Implementations"
status: done
priority: P0
labels: ["tasks", "5sp", "protocols", "socket-io", "web-client"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 13-06: Socket.IO Record Implementations

**Epic:** 13 — System Projections, Socket.IO & REST Compat Layer

## Description

Create record implementations of each protocol backed by Socket.IO. Web clients connect via socket.io and speak the same event envelope protocol. The server-side socket.io handler is a record implementing the same protocol interface as Mongo and REST.

## Why Socket.IO

Socket.IO terminology is already a match for the architecture:

| Socket.IO | Architecture equivalent |
|-----------|------------------------|
| namespace | system domain (`auth`, `session`, `graph`) |
| room | causal/session scoping (`causal/root`, `session/id`) |
| event | event ledger envelope (`user.create.request`) |
| connection | actor reference (client is an actor) |
| emit/on | protocol methods |
| middleware | contract validation (μ gates) |

Web clients become actors. They emit events, the server processes them through the same ledger, and responses come back as events. No REST round-trip needed.

## Acceptance Criteria

**Server-side (`packages/openplanner-protocols/`):**

- `SocketIoRecord` defrecord implementing each protocol
- Constructor takes a socket.io server instance
- Registers namespace handlers per system domain:
  - `/auth` namespace → UserManagement (signup, login, profile, password)
  - `/graph` namespace → GraphOperations
  - `/translation` namespace → TranslationManagement
  - `/labels` namespace → LabelManagement
  - `/documents` namespace → DocumentStorage
- Each namespace handler:
  - Validates incoming event against envelope schema (μ gate)
  - Writes event to ledger via EventAdmission protocol
  - Forwards to the appropriate system watcher
  - Emits response event back to the client's room
- Room management:
  - Server generates `causal/root` UUID server-side (not client-provided) on each request
  - Client is auto-joined to `req:{causal-root}` room
  - Response events emitted to that room by the processing system
  - Room cleaned up after response or 30s timeout
  - Each request gets its own room (no concurrent request sharing)
  - Disconnect handler cleans up all rooms for that socket

**Client-side (JS/TS, for web clients):**

- `OpenPlannerClient` class:
  - Connects to socket.io server
  - `emit(eventType, payload)` → sends envelope to server
  - `on(eventType, callback)` → listens for response events
  - `joinRoom(roomId)` → joins a socket.io room
  - Auto-reconnect with resume token (replay missed events)
- Event envelope wrapping: client `emit` auto-adds `event/id`, `event/time`, `event/from`
- Response routing: responses come back on the same namespace, filtered by `causal/root` room

**Middleware:**

- Socket.IO middleware validates envelope schema on every inbound event
- Rejects malformed events with structured error
- Rate limiting per connection (contract: `:contract.kind/policy`)

## Mapping to Protocol

The Socket.IO record implements the same CLJS protocols:

```clojure
;; EventAdmission protocol — socket.io record
(append-event! [this event]
  ;; emit to server, await ack
  (.emit socket "event:append" (encode-envelope event)))

(query-events [this filter]
  (.emit socket "event:query" (encode-filter filter))
  (.once socket "event:query:result" decode-results))

(watch-events [this filter callback]
  (.on socket "event:watch" (fn [event] (callback (decode-envelope event))))
  (.emit socket "event:watch:subscribe" (encode-filter filter)))
```

The client-side wrapper makes this feel like a local protocol call.

## Implementation Location

- Server records: `packages/openplanner-protocols/src/openplanner/records/socket_io/`
- Client library: `packages/openplanner-client/` (thin client adapter — TS allowed here as it's a transport wrapper, not business logic)
- Socket.IO server setup: `packages/event-ledger/` (alongside the ledger)

## Source Notes

- Socket.IO namespaces: https://socket.io/docs/v4/namespaces/
- Socket.IO rooms: https://socket.io/docs/v4/rooms/
- The existing Knoxx backend already uses socket.io patterns (Discord gateway = similar model)
- Client is the first TypeScript in `packages/` — but it's a thin client library, not business logic

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
