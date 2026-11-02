---
uuid: "openplanner-16-03-extract-server-externs"
title: "16-03: Extract Server Externs → packages/externs/fastify"
status: proposed
priority: P1
labels: ["tasks", "3sp", "decomposition", "externs", "fastify", "packages"]
created_at: "2026-06-06T00:00:00Z"
category: "tasks"
---

# 16-03: Extract Server Externs → `packages/externs/fastify`

**Epic:** 16 — Extraction Foundation
**Depends on:** 16-01

## Description

Move the HTTP-server boundary adapters into `packages/externs/fastify`
(`@open-hax/extern-fastify`): the Fastify request/reply interop and the TypeBox schema
tools used to declare route/tool schemas.

**In scope:** `extern/{fastify,tools}.cljs`

If `tools.cljs` (TypeBox) turns out to be consumed by tool schemas independent of
Fastify, split it into its own tiny package (`@open-hax/extern-typebox`) — decide
during extraction, record the call in the PR description.

## Acceptance Criteria

- `packages/externs/fastify/` scaffolded from the 16-01 template
- Namespaces moved + renamed per template convention
- `fastify` (and `@sinclair/typebox` if split) declared as peer/regular deps of the
  package, not of knoxx
- Tests move with the namespaces
- Package(s) published; knoxx cutover deferred to 16-06

## Implementation Location

`packages/externs/fastify/` (+ optional `packages/externs/typebox/`)

## Source Notes

- Source: `packages/agents/knoxx/backend/src/cljs/knoxx/backend/extern/{fastify,tools}.cljs`
- Future consumer: `@open-hax/http-host` (E20) — keep its needs in mind, don't design for them yet

## Verification (non-negotiable)

1. `npx shadow-cljs compile test` — 0 failures, 0 errors
2. `npx shadow-cljs compile lib` — 0 warnings
3. `npx clj-kondo --lint src test` — 0 errors, 0 warnings
4. **Code review:** Dispatch a code review sub-agent. No critical issues before done.
