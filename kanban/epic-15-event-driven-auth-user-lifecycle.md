---
uuid: "openplanner-event-driven-auth-user-lifecycle"
title: "Epic: Event-Driven Auth & User Lifecycle"
status: incoming
priority: P1
labels: ["epic", "auth", "events", "user-lifecycle", "watcher", "mongo"]
created_at: "2026-06-05T00:00:00Z"
category: "epic"
---

# Epic: Event-Driven Auth & User Lifecycle

## Objective

Implement the event-driven user lifecycle as the first real end-to-end example of the ledger pattern. When a user interacts with the signup page and presses "create user", that becomes a `user.create.request` event. An auth system watches for that event, creates the user document, and emits `user.create.success`. The HTTP server creates a temporary watcher (change stream) to observe the outcome.

## Key Design Decisions

- All user lifecycle actions enter as events: `user.create.request`, `user.update.request`, `user.delete.request`, `user.login.request`
- Auth system is a watcher that subscribes to `user.*.request` events
- Auth system writes to `knoxx_users` projection collection
- On success, auth system emits `user.create.success` (or `.failure`) event
- HTTP handlers create temporary change stream watchers to observe the response event
- Watchers have timeout + cleanup (temporary, not permanent subscriptions)
- This pattern becomes the template for all system interactions
- The "trigger" concept from Knoxx maps directly to Mongo change stream `.watch()`
- **Auth system is its own package: `packages/auth-system/` (ClojureScript). No new TypeScript.**

## Dependencies

- Epic 12 (event ledger foundation)
- Epic 13 (projection infrastructure)
- Epic 14 (Knoxx Mongo migration — users collection)

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

- `user.create.request` event written to ledger on signup
- Auth system watches ledger, creates user in `knoxx_users`
- `user.create.success` event emitted on completion
- HTTP handler creates temporary watcher, awaits success/failure event
- Timeout + cleanup for watchers works
- Same pattern demonstrated for `user.login.request`
- Pattern documented as template for future systems

## Tasks

| Task | Points | Depends On | Status |
|------|--------|-----------|--------|
| 15-01: User lifecycle event type definitions | 2 | — | Proposed |
| 15-02: Auth system watcher for user events | 8 | 15-01 | Proposed |
| 15-03: Temporary watcher infrastructure (create, await, timeout, cleanup) | 5 | 12-03 | Proposed |
| 15-04: Signup page → event → watcher → response flow | 5 | 15-02, 15-03 | Proposed |
| 15-05: Login flow via same event pattern | 3 | 15-02, 14-01 | Proposed |

**Total: 23 points**
