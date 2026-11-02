---
uuid: "openplanner-event-ledger-foundation"
title: "Epic: Event Ledger Foundation"
status: done
priority: P0
labels: ["epic", "event-ledger", "mongo", "architecture", "core"]
created_at: "2026-06-05T00:00:00Z"
category: "epic"
---

# Epic: Event Ledger Foundation

## Objective

Build the append-only Mongo event ledger that becomes the single ingestion point for all system actions. Every action enters through the ledger. Systems watch it and produce effects in their own projection collections. Events default TTL: 1 month. Anything we want persisted must eventually take action on events.

## Key Design Decisions

- Ledger is a single Mongo collection (`event_ledger`) with TTL index on `expiresAt`
- Every document conforms to an envelope shape: `event/id`, `event/type`, `event/time`, `event/from`, `event/to`, `causal/root`, `causal/parent`, `session/id`, `turn/id`, `payload`
- `event/id` (uuid) is the unique key; ledger assigns `ledger/seq` monotonically server-side
- MongoDB change streams are the primary watch mechanism for systems
- REST `/events` endpoint writes to the same ledger (compatibility layer for external services)
- Legacy `events` collection remains readable during transition
- Kafka is shelved; all distribution via Mongo change streams for now
- **All new code lives in `packages/` as standalone modules. No new TypeScript. `src/` is dead for new work.**
- **All code uses `^:async` + `await` for async workflows. No `.then`/`.catch` chains.**

## Dependencies

- None (foundational)

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

- `event_ledger` collection exists with TTL index and unique index on `event/id`
- Append primitive validates envelope shape before insert
- `ledger/seq` assigned server-side, cannot be forged
- Change stream watcher can subscribe to event kinds
- REST `/events` endpoint writes to ledger
- Legacy `events` collection remains readable
- **New package: `packages/event-ledger/`**

## Tasks

| Task | Points | Depends On | Status |
|------|--------|-----------|--------|
| 12-01: Event ledger Mongo collection + schema | 3 | — | Done |
| 12-02: Envelope validation + append primitive | 5 | 12-01 | Done |
| 12-03: Change stream watcher infrastructure | 5 | 12-01 | Done |
| 12-04: REST compatibility adapter | 3 | 12-02 | Done |
| 12-05: Event TTL configuration | 3 | 12-01 | Done |
| 12-06: Legacy events collection bridge | 3 | 12-04 | Done |

**Total: 22 points**
