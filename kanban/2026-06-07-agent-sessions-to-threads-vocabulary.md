---
uuid: "openplanner-2026-06-07-agent-sessions-to-threads-vocabulary"
title: "Agent 'sessions' → 'threads' vocabulary migration"
status: todo
priority: P2
labels: ["tasks", "knoxx", "threads", "naming", "migration"]
created_at: "2026-06-07T17:45:00Z"
category: "tasks"
---

# Agent "sessions" → "threads" vocabulary migration

## Rationale (decision 2026-06-07)

"Session" is overloaded: agent conversations, browser auth sessions, and the
E15 collection-collision gotcha proved the cost (a PG auth-session row landed
in the agent conversation collection). Agent conversations are now **threads**:

1. Outside agents, the only other "thread" is a CPU thread — and those never
   need a collection.
2. "Thread" matches the conversational nature of user/agent interaction.
3. The CPU-thread overlap is semantically *cleaner* than the browser-session
   overlap: agents are smart processes — Promethean (the spiral ancestor)
   already models them that way.

Auth/browser sessions **keep** the word "session" (`knoxx_policy_sessions`).

## Done (2026-06-07, collection layer)

- `knoxx_sessions` → `knoxx_threads` (stray PG auth-session row not carried over)
- `knoxx_session_titles` → `knoxx_thread_titles`
- `knoxx_memory_sessions` → `knoxx_memory_threads` (TTL cache, no copy needed)
- Indexes recreated to match each store's `setup-indexes!`
- Old collections retained pending verification + sign-off to drop

## The reconciliation: which "session" is which (boundary decision 2026-06-07)

A repo-wide rename is a TRAP — `session` means three+ different things in the
backend. Mapped from `backend/src/cljs/knoxx/backend`:

**A. AGENT THREAD → rename to "thread" (eventually):**
- `shape/session_persistence.cljs` (`ISessionStore`→`IThreadStore`, `KnoxxRun`)
- `infra/stores/session_store_registry.cljs`, `mongo_session_store.cljs`
  (collection already `knoxx_threads`), `openplanner_session_store.cljs`,
  `session_flush.cljs`, `session_titles.cljs` + `mongo_session_titles.cljs`
- `shape/memory_sessions.cljs` + `infra/stores/mongo_memory_sessions.cljs`
- `infra/agent/session.cljs`, `infra/agent/session_registry.cljs`
- `domain/action/start_agent_session.cljs`

**B. KEEP "session" — auth/browser/cookie (NOT threads):**
- `infra/auth/session.cljs`, `infra/auth/auth_session.cljs`, `infra/routes/auth.cljs`,
  `infra/auth/authz.cljs`, `mongo_policy_store.cljs` (`knoxx_policy_sessions`),
  `bootstrap.cljs` session-hook, `routes/mcp.cljs` mcp-sessions, `clients/github.cljs`

**C. KEEP "session" — external-tool session ingest (upstream's vocabulary):**
- `infra/eta_mu_session_ingester.cljs`, `infra/source/opencode_session_ingester.cljs`
  — these read OTHER tools' "sessions"; renaming would misrepresent the upstream.

**D. KEEP / review — meta work-session:**
- `domain/session_mycology.cljs` (per-turn retrospection; "session" = a work session,
  not a stored thread). Lean keep; confirm with operator.

**E. WIRE-FORMAT LOCKED — do NOT touch in any code rename:**
- The event-ledger `session` field = `source_ref.session` = conversation id, in
  `openplanner/memory.cljs`, `routes/memory.cljs`, `openplanner_session_store.cljs`
  (event projection), `session_titles.cljs` (reads ledger), `eta_mu_session_ingester.cljs`,
  `discord_reaction_labels.cljs`. Renaming the wire field is a **schema-version bump
  with lazy migration**, decided separately — never a search-and-replace.

## Ordered slices (smallest-safe first; do one, verify, stop)

1. **[safe, code-only] Rename group A namespaces/files + vars to `thread`.** Pure
   refactor: no persisted-data change (collections already `knoxx_threads`), no wire
   change, no external API change. Touch only group A + their `:require`rs. Verify:
   `shadow-cljs compile server` + test, clj-kondo, no runtime break on hot reload.
   This is the next cut. Likely several sub-slices (one store at a time) to keep
   each edit reviewable.
2. **[safe, protocol] `ISessionStore` → `IThreadStore`** (`shape/session_persistence`)
   + its two implementers (`mongo_run_store`, `openplanner_session_store`). Compile-verified.
3. **[medium, data] `session_id` field → `thread_id` on thread docs** — needs a
   dual-read window (read both keys) + a data migration, then drop the old key. Its
   own task; do NOT bundle with the namespace rename.
4. **[medium, API] OpenPlanner `/v1/sessions` → `/v1/threads`** with `/v1/sessions`
   kept as a compat alias for external consumers. Knoxx client switches to `/v1/threads`.
5. **[deferred, schema] Wire-field `source_ref.session`** — schema-version bump +
   lazy migration. Group E. Separate epic-level decision; not part of this card.
6. **[after sign-off] Frontend API client + UI copy; drop old collections.**

## Adjacent: auth-session reconciliation (event-ledger M4 blocker)

This same disambiguation answers event-ledger M4's open question: agent
conversations = **threads** (`knoxx_threads`); auth/browser/cookie sessions stay
**sessions** (`knoxx_policy_sessions`). E15's `auth_sessions` should reconcile INTO
`knoxx_policy_sessions` (or be the same collection) — operator decision, but the
naming boundary is now settled, which unblocks 15-02.

## Constraints

- Merges only, no rebase (workspace git policy).
- No new TypeScript (knoxx backend is CLJS).
- Event envelope `openplanner.event.v1` field renames need a schema version bump +
  lazy migration — never a search-and-replace pass (group E).
- One slice at a time, verified, reversible. Do not chain slices 1→6 in one pass.
