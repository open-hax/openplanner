---
uuid: "openplanner-provider-protocol-contracts"
title: "Epic: Provider-Call Protocol Contracts — Describe Calling OpenAI-style Providers as Data"
status: incoming
priority: P1
labels: ["epic", "contracts", "interpreter", "proxx", "embeddings", "providers", "data-oriented"]
created_at: "2026-06-07T00:00:00Z"
category: "epic"
---

# Epic 23: Provider-Call Protocol Contracts

Part of the [contract roadmap](contract-roadmap.md), phase C1.

## Objective

Describe **calling an OpenAI-style provider** (chat, embeddings, images, etc.) as
EDN contracts + a CLJS contract-understanding client — not as bespoke HTTP code.
Today this layer exists only as "how it works through the API." This epic gives it
a protocol so the *fact of how to call a provider* lives in policy, and the client
that honors those facts is reusable.

The client proxx uses internally becomes this contract client. But the contracts
must be **equally usable from any client without going through proxx** — that is the
test that the protocol, not the proxy, holds the knowledge.

## Why now

The 2026-06-07 embedding outage made the gap concrete: `proxx/src/routes/embeddings.ts`
selected `ollama-lan` via policy but then POSTed to the global `OLLAMA_BASE_URL`
(down local ollama), ignoring the per-provider base-url that already lived in the
`provider-route/*` contract. Routing decided correctly; the *call* layer had a fact
hardcoded in source. A described provider-call protocol + a client that reads the
provider-route contract makes that class of bug structurally impossible.
(Stopgap fix already landed: the route now reads `candidate.baseUrl`. This epic
generalizes it. See [[proxx-embeddings-per-provider-base-url]].)

## Scope

- **Provider-call protocol contracts** (EDN): request-kind → upstream-mode mapping,
  per-provider base-url + paths (already partly in `provider-route/*` /
  `20-provider-capabilities.edn`), payload shape per mode (openai chat, ollama
  `/api/embed`, openai `/v1/embeddings`, hf/tei/ovm embeddings), model-name
  resolution per provider (alias), and fallback order semantics.
- **Embeddings first** — the narrowest, freshest slice. The bare contract: "for an
  embeddings request, here are the eligible providers in order, each with its base
  url, path, payload transform, and model alias." Then the client just *executes*
  that, instead of branching on provider identity in TS.
- **A CLJS contract-understanding provider client** that consumes those contracts to
  build + dispatch the upstream call. proxx imports it at its HTTP edge; it is also
  importable standalone.
- **Move `EMBED_PROVIDER_MODEL` into a contract fact** (the operator's named first
  target): default embedding model is a policy fact, env only overrides. Aligns with
  [[direction-env-yaml-to-edn-contracts]].

## Non-goals

- Not extracting proxx into openplanner packages yet (that's C4 — solidify the shape
  here first).
- Not touching public API surfaces or external consumers.
- Not centralizing into one interpreter — this is the provider-call interpreter,
  distinct from routing/queue/strategy interpreters.

## Constraints

- **No new TypeScript.** New logic is shadow-cljs interpreting contracts; TS stays as
  the thin edge that calls the CLJS client. (`src/routes/` may stay TS per proxx
  CLAUDE.md, but provider-call *logic* must not grow there.)
- Facts in EDN, env as override only.
- Edit the live service policy tree deliberately; repo defaults and service policies
  are intentionally divergent — see [[proxx-policy-trees-not-lockstep]].
- proxx caches compiled policy and runs host-mounted `dist/`; EDN/dist changes need a
  `docker restart proxx-local-proxx-1`.

## First slice (smallest reversible step)

Describe the **embeddings** provider-call as a contract the existing CLJS already
half-implements (`:provider-order/embeddings`, `provider-route/*` paths), and have a
small CLJS dispatch read base-url + path + model-alias from contract so the TS route
becomes a near-passthrough. Verify with the live 1024-dim ollama-lan embedding and
the `embeddings-strategy` tests. Map before editing.

## Verification

1. `pnpm build` (TS + shadow-cljs) clean.
2. `npx tsx --test src/tests/embeddings-strategy.test.ts` — 0 fail.
3. Live: `POST /v1/embeddings` (embed token) → 200 + 1024-dim vector from ollama-lan
   with both local upstreams down (fallback proven from contract, not code).
4. The same contract drives an embedding from a standalone client (no proxx route).
