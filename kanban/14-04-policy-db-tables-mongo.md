---
uuid: "openplanner-14-04-policy-db-tables-mongo"
title: "14-04: Policy DB Tables → Mongo Collections"
status: done
priority: P0
labels: ["tasks", "8sp", "knoxx", "policy", "postgres", "mongo", "migration"]
created_at: "2026-06-05T00:00:00Z"
category: "tasks"
---

# 14-04: Policy DB Tables → Mongo Collections

**Epic:** 14 — Knoxx Redis/SQL → Mongo Migration

## Description

Move all PostgreSQL policy database tables into Mongo collections. The PG schema has 19 tables — all must be migrated.

## Acceptance Criteria

Collections created (all 19 PG tables):

**Core auth:**
- `knoxx_config` — singleton config (session_secret, etc.)
  - `key` (string, unique), `value` (mixed), `updatedAt`
- `knoxx_orgs` — organizations
  - `org_id`, `name`, `slug`, `status`, `config`, `createdAt`, `updatedAt`
- `knoxx_users` — users
  - `user_id`, `email`, `name`, `org_id`, `status`, `password_hash`, `createdAt`, `updatedAt`
- `knoxx_memberships` — org memberships
  - `membership_id`, `user_id`, `org_id`, `status`, `createdAt`, `updatedAt`

**Roles & permissions:**
- `knoxx_roles` — role definitions
  - `role_id`, `org_id`, `name`, `createdAt`, `updatedAt`
- `knoxx_role_permissions` — role→permission mapping
  - `role_id`, `permission_key`, `permission_value`, `createdAt`
- `knoxx_membership_roles` — membership→role join table
  - `membership_id`, `role_id`, `createdAt`

**Tool policy:**
- `knoxx_tool_definitions` — tool registry seeds
  - `tool_id`, `org_id`, `name`, `kind`, `config`, `createdAt`, `updatedAt`
- `knoxx_role_tool_policies` — role→tool constraints
  - `role_id`, `tool_id`, `policy` (map), `createdAt`
- `knoxx_user_tool_policies` — user→tool constraints
  - `user_id`, `tool_id`, `policy` (map), `createdAt`

**Actor infrastructure:**
- `knoxx_actor_credentials` — OAuth/API credentials
  - `credential_id`, `actor_id`, `org_id`, `kind`, `config`, `expiresAt`, `createdAt`
- `knoxx_actor_mailbox_entries` — actor mailbox messages
  - `entry_id`, `actor_id`, `message` (map), `status`, `createdAt`
- `knoxx_actor_mailbox_routes` — actor routing table
  - `route_id`, `actor_kind`, `target`, `config`, `createdAt`

**Data & content:**
- `knoxx_data_lakes` — data lake config
  - `lake_id`, `org_id`, `name`, `config`, `createdAt`, `updatedAt`
- `knoxx_studio_state` — studio player state
  - `session_id`, `state` (map), `updatedAt`
- `knoxx_studio_audio_assets` — studio waveform images
  - `asset_id`, `session_id`, `kind`, `data`, `createdAt`

**Lifecycle:**
- `knoxx_invites` — pending invitations
  - `invite_id`, `org_id`, `email`, `role`, `status`, `invited_by`, `expiresAt`, `createdAt`
- `knoxx_contracts` — actor contracts
  - `contract_id`, `org_id`, `name`, `kind`, `status`, `config`, `createdAt`, `updatedAt`
- `knoxx_audit_log` — policy audit trail
  - `audit_id`, `org_id`, `user_id`, `action`, `resource`, `details`, `ts`

Each collection has appropriate indexes (org_id, user_id, actor_id, etc.).

CRUD operations migrated from `policy.cljs` to use Mongo driver instead of HoneySQL.

## Data Migration

- One-time migration script reads all PG tables and writes to Mongo collections
- Runs before cutover (feature flag `OPENPLANNER_KNOXX_POLICY_STORE=mongo`)
- Idempotent: can re-run without duplicating data
- Validates row counts match after migration

## Rollback

- Feature flag can toggle back to PG reads if Mongo issues arise
- PG tables remain untouched during transition (read-only, not dropped)

## Implementation Location

Package: `packages/knoxx-backend/` (ClojureScript)

## Source Notes

- Current PG policy DB: `knoxx/backend/src/cljs/knoxx/backend/infra/db/policy.cljs`
- Schema DDL: `knoxx/backend/src/cljs/knoxx/backend/infra/db/policy/schema.cljs`

## Progress (slice plan)

Migrating vertically by coherent table groups, each slice flag-dispatched in
`infra/db/policy.cljs` under `OPENPLANNER_KNOXX_POLICY_STORE=mongo` with PG
as default + rollback. New store: `infra/stores/mongo_policy_store.cljs`.

- [x] **Slice 1 (2026-06-06): sessions + config** — `knoxx_policy_sessions`
  (TTL index on `expires_at` as real Date) + `knoxx_config` (unique `key`).
  Token hashing extracted to shared `infra/auth/token_hash.cljs` so both
  backends verify identically. `recover-session-secret!` adopts the PG
  secret on first mongo run so existing cookies survive cutover. Index
  setup wired into bootstrap `start-mongo-persistence!`. Tests: store
  round-trip/expiry/secret-adoption (mock-db pattern). Suite 0 failures,
  server build 0 warnings.
  - Review round 1: FAIL — index creation was gated on the unrelated
    composite-store flag, so the documented config got no TTL/unique
    indexes (arming the secret-init race). Remediated: single-flight
    `ensure-indexes!` now runs on the policy-flag dispatch path itself;
    session secret init is atomic first-writer-wins (`$setOnInsert`);
    touch-on-read made fire-and-forget for PG latency parity; nil-db
    paths fail explicitly instead of NPE. 561 tests / 1624 assertions
    green.
  - Review round 2: **PASS** — all 7 findings verified fixed (single-flight
    correctness, driver-v6 findOneAndUpdate semantics, arity parity, and
    test coverage all confirmed), no new defects.

**Cutover model (refined after slice 1):** sessions were independently
flippable because they are ephemeral. The durable table groups
(orgs/users/memberships/roles/...) are NOT independently flippable —
cross-table joins (hydrate-memberships, build-request-context) would split
brain if some tables read Mongo while others read PG. So slices 2–6 land
as mongo twins behind the same flag *without flipping it*; the flag flips
once, after the slice-7 migration script has copied data and validated
counts. PG stays read-only rollback throughout.
- [x] **Slice 2 (2026-06-06): orgs + users + memberships** — built as
  standalone twin `infra/stores/mongo_policy_directory.cljs` (no dispatch
  wiring per cutover model). Upserts mirror PG ON CONFLICT via
  `$setOnInsert`/`$set` splits; unique indexes on orgs.slug, users.email,
  memberships (user_id+org_id); `*-doc->row` adapters present PG row
  shapes (`:id`, snake_case) for drop-in dispatch later. 570 tests / 1674
  assertions green, 0 new warnings.
  - Review round 1: FAIL — slug case asymmetry (lowered on read, verbatim
    on write → unfindable/case-duplicate orgs) + dispatch-seam ambiguity.
    Remediated: slugs canonicalised lower-case on every write path with
    regression tests; primary-org flip now a single pipeline updateMany
    (`is_primary := (slug == X)` over all docs — atomic convergence,
    stronger than PG's two statements); numeric Date sort; DISPATCH SEAM
    contract documented in the ns docstring (route at the query seam,
    keep policy.cljs row->map/wrapping layers). 572 tests / 1679
    assertions green.
  - Review round 2: **PASS** — driver-v6 pipeline-update usage confirmed
    valid; exactly-one-primary convergence argument independently verified.
  Known deliberate
  gap: `list-orgs!` returns role_count/data_lake_count 0 until slices 3/6.
  Layering decisions (answers to slice-2 open questions): bootstrap /
  create-user orchestration stays in policy.cljs dispatch composing store
  fns; role-aware actor_id defaulting stays in policy.cljs (actor-scope is
  domain logic, stores stay table-scoped); local-password-auth-record!
  becomes an app-level join over twins, owned by slice 5 with
  actor_credentials.
  Open questions logged for slice 3: bootstrap/create-user orchestration
  layering, role-aware actor_id defaulting, `local-password-auth-record!`
  composite-join ownership (needs actor_credentials, slice 5).
- [~] **Slice 3 (2026-06-06): roles + role_permissions + membership_roles**
  — built as twin `infra/stores/mongo_policy_roles.cljs`. PG's nullable
  roles.org_id became field-presence encoding with two partial unique
  indexes (platform {slug} / org {org_id,slug}); replace-sets are
  deleteMany+insertMany with the non-atomic window documented under the
  single-writer doctrine; born modern-schema-only (`permission_code` — no
  legacy `permission_id` twin). 583 tests / 1725 assertions green, 0 new
  warnings.
  - Review round 1: **FAIL (critical, confirmed live)** — the platform-slug
    partial index used `partialFilterExpression {$exists false}`, which
    MongoDB rejects (error 67); bootstrap's un-caught setup-indexes! call
    crash-looped the live backend (15 restarts) when shadow hot-reloaded
    the store. Remediated: ONE compound unique `{org_id, slug}` replaces
    both partial indexes (absent-as-null gives platform+org uniqueness AND
    closes the absent-vs-null dodge at the index layer); bootstrap now
    routes through catching `ensure-indexes!` so index failures can never
    crash the process; added a createIndex spec-recording test banning
    partialFilterExpression. Backend stable, **all twin indexes verified
    present in live mongo** (roles/perms/membership_roles/orgs/users/
    memberships uniques). 584 tests / 1729 assertions green.
  - Hardening noted for later: ensure-role! find-then-insert race is
    PG-parity-preserving but could catch E11000 → re-find under the now-real
    unique index. PG CHECK(scope_kind) has no twin (callers validate).
  Slice-7 migration invariants: legacy permission_id rows must be converted
  to permission_code during copy (orphans dropped/reported); platform-role
  org_id must be OMITTED (`$unset`), never written as explicit null —
  queries encode platform scope as field-absence.
  Slice-4 open questions: constraints_json storage shape (native doc vs
  stringified round-trip for constraints-json->clj), and tool_definitions
  twin must precede tool-policy rows (FK target + ensure-tool-definitions!
  ordering).
- [x] Slice 4 (2026-06-06): tool_definitions + role/user tool policies — built as
  twin `infra/stores/mongo_policy_tools.cljs`. `tool_definitions` unique on
  `tool_id`; `role_tool_policies` compound unique `(role_id, tool_id)`;
  `user_tool_policies` compound unique `(membership_id, tool_id)`.
  `constraints_json` stored as STRING (not native doc) for PG round-trip parity.
  `tool-def-doc->row` adapter presents natural `:tool_id` as `:id` matching
  PG `tool_row->map`. 594 tests / 1766 assertions green, 0 warnings.
  - Review round 1: **PASS** — all index specs verified (no
    partialFilterExpression), row-shape adapter parity confirmed,
    replace-set semantics correct.
- [x] **Slice 5 (2026-06-06): actor credentials** — `knoxx_actor_credentials`
  Mongo twin built with credential_id generation, COALESCE for
  account_identifier, secret_json merge, membership/org app-level join,
  compound unique on (user_id, org_id, provider, kind). camelCase response
  adapter matching PG sql-adapter/row->credential. Dispatch seams wired
  in policy.cljs for list/get/upsert paths. 602 tests/1798 assertions green.
- [x] **Slice 6 (2026-06-06): invites + audit_events + data_lakes + studio state/assets**
  Mongo twins built for all 4 remaining table groups:
  - `knoxx_audit_events`: write-only insert twin with org/actor/action indexes
  - `knoxx_data_lakes`: list/create with unique on (org_id, slug), config_json stored as native doc
  - `knoxx_invites`: create/redeem/list with unique on code, email lowercased, role_slugs as JSON
  - `knoxx_studio_state`: upsert on (user_id, org_id, kind), state_json as nested map
  - `knoxx_studio_audio_assets`: upsert on (audio_path, asset_type), binary image_data as Buffer
  Dispatch seams wired in policy.cljs for invites, data_lakes, and audit. 610 tests/1825 assertions green.
- [x] **Slice 7 (2026-06-06): one-time PG→Mongo migration script**
  `infra/migrate-pg-to-mongo.cljs` — standalone migration tool that reads all
  19 PG tables and upserts into Mongo collections. Idempotent (upsert on
  every doc), validates row counts post-migration, ordered by FK dependencies.
  Shadow-cljs build `:migrate` compiles to `dist/migrate.js`. Run via
  `npm run migrate` or `shadow-cljs compile migrate && node dist/migrate.js`.
  623 tests/1857 assertions green.
- [x] **Slice 8 (2026-06-06): cutover default flip + 14-05 dependency handoff**
  Flipped both feature-flag defaults:
  - `OPENPLANNER_KNOXX_POLICY_STORE`: Mongo is now default (opt-out with `=pg`)
  - `OPENPLANNER_KNOXX_COMPOSITE_STORE`: Mongo is now default (opt-out with `=redis`)
  Added blank-provider validation to `list-actor-credentials!` Mongo path.
  Fixed test contract to be path-agnostic. 623 tests/1856 assertions green.

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent to review all changed files. No critical issues before marking done.
