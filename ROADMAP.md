# Roadmap — openplanner's slice

> Hub: **[eta-mu/ROADMAP.md](https://github.com/open-hax/eta-mu/blob/main/ROADMAP.md)** — read that for the seam, the ownership
> table, and the sequencing rule. This file is only openplanner's slice.
> Last surveyed: 2026-08-04.

## What openplanner is, on this roadmap

**Being dismantled.** No epic yet; this file is the interim plan.

19 packages: `agents axxium clients contract-runtime event-ledger gardens graph
openplanner-client openplanner-protocols openplanner-sdk promptdb-core services
signals stores translations utils vexx workers`.

## Do not bulk-copy `packages/**` into eta-mu

Two concrete reasons:

1. **`contract-runtime` and `event-ledger` are already standalone repos.** A bulk
   copy creates a *third* copy of each — the precise failure the cutover exists
   to stop.
2. `eta-mu/kanban/eta-mu-charter-v1.md`: *"This repo is not meant to be 'the place
   where every absorbed package goes forever.' It is meant to be the canonical
   home of that orchestration loop."*

## The order that actually reduces copies

1. **Repoint consumers at the standalone repos, then delete the local copies.**
   - `contract-runtime` — standalone (17 files) and `packages/` (17 files).
     **knoxx builds against the `packages/` copy** via
     `backend/shadow-cljs.edn` → `../../contract-runtime/src/cljs`, staged in CI.
     Repoint knoxx, delete `packages/contract-runtime`.
   - `event-ledger` — standalone (44 files) is **ahead** of `packages/` (15
     files); they have diverged. The local copy is stale; delete after checking
     nothing consumes it.
2. **Per remaining package, decide a home before moving it**: eta-mu (part of the
   orchestration loop), its own repo (a real product — `proxx`, `uxx`,
   `voxx-clj`, `epiphany`, `lakeraven`, `axxium` already are), or delete
   (superseded). Record the decision. Do not move first and decide later.
3. **Retire the REST API surface.** Barely used. The one live consumer is knoxx's
   CMS compatibility path, which calls a host OpenPlanner HTTP service on
   `host.docker.internal:7777` that **production does not run** — so the knoxx
   deploy health gate logs `CMS surface skipped` on every deploy. Retiring the
   CMS removes the last REST-only dependency in the deployed stack, and with it
   the `KNOXX_EXPECT_OPENPLANNER_REST` flag and a whole conditional branch of the
   gate. See `knoxx:knoxx-cms-contract-validation` and
   `knoxx:knoxx-arch-migration-cms-routes-retirement` (already in `breakdown`).

## Postgres

Only **`axxium`** still declares a pg dependency. Everything else is clear;
knoxx's backend has zero references. That is the remaining holdout.

## What is still consumed from here

`openplanner-sdk` — knoxx runs the OpenPlanner data plane **in-process** through
it (`KNOXX_OPENPLANNER_CLIENT_MODE=mongo`) straight against Atlas. Chat,
sessions and vector search need no OpenPlanner service. Do not break the SDK
while dismantling the rest.
