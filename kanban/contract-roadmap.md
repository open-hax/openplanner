---
uuid: "openplanner-contract-roadmap"
title: "Contract Architecture Roadmap"
status: incoming
priority: P0
labels: ["roadmap", "contracts", "interpreter", "data-oriented", "proxx", "openplanner", "knoxx"]
created_at: "2026-06-07T00:00:00Z"
category: "specs"
---

# Contract Architecture Roadmap

Date: 2026-06-07
Status: proposed

## Purpose

The companion to the [event ledger roadmap](event-ledger-roadmap.md). Where the
ledger roadmap describes **how systems communicate** (everything through Mongo,
change streams, Socket.IO), this roadmap describes **what the systems become**:
data-oriented contract interpreters.

OpenPlanner started as an API + data lake. It still is — but the REST API stops
being the center of gravity. The API becomes a *secondary surface*: one way to
plan capabilities out as contracts. OpenPlanner becomes the home where the
contracts live, so the rest of `~/devel` is less distracting — there is one place
the system's behavior is described as data.

This is the larger pattern behind everything: **data-oriented, and not restarting.**
Not restarting is what makes it hard — we grow and absorb instead of greenfielding —
and it is also the whole point.

## North star

```
        ┌─────────────── OpenPlanner ───────────────┐
        │  data lake + contract home + interpreters  │
        │  (contracts published as npm packages)     │
        └───────▲───────────────▲───────────────▲────┘
                │ consumes       │ consumes      │ consumes
              proxx            knoxx           (other clients)
         (thin shell around   (agents,         (coding clients,
          interpreters)        dashboards)      external systems)

   Public APIs of all three KEEP EXISTING (external consumers depend on them).
   INTERNALLY, they stop calling each other's HTTP APIs and talk only through
   Mongo (see event-ledger-roadmap). The contracts are the shared language.
```

## Architecture rules

1. **No new TypeScript, anywhere.** Everything is shadow-cljs, data-oriented. New
   logic interprets contracts; it is not business logic in source. TS survives
   only as the thin HTTP edge (request parse / response serialize).
2. **Facts live in EDN contracts**, never in source, env switches, or YAML.
   (See [[direction-env-yaml-to-edn-contracts]] — env files shrink as their
   values become contract facts with env as override.)
3. **You cannot centralize a single contract interpreter — but you can centralize
   the *concept*.** A shared substrate of interpreter-pattern shapes; each system
   keeps its own interpreter. The systems are distinct for a reason.
4. **Public APIs are forever; internal API calls are temporary.** External
   consumers (proxx's coding clients, knoxx's dashboards, future openplanner API
   users) keep their endpoints. The migration is purely about *internal* coupling.
5. **proxx logic migrates into openplanner, ships as npm packages, proxx consumes
   them** — repeated until proxx is a thin shell around the interpreters.

## How it composes with the other roadmaps

| Roadmap | Owns |
|---|---|
| [event-ledger-roadmap](event-ledger-roadmap.md) | Transport: Mongo ledger, change streams, Socket.IO, projections (E12–E15, M5) |
| [monorepo-roadmap](monorepo-roadmap.md) / extraction epics 16–22 | Packaging openplanner internals into npm packages; ledger adoption |
| **contract-roadmap (this doc)** | The *lens*: what gets extracted are **contract interpreters + shared shapes**; the data-oriented discipline; the proxx-absorption arc; the provider-protocol gap |

This roadmap does not replace those — it states the organizing principle they all
serve, and adds the pieces they don't yet cover.

## Milestones

| Phase | Name | Status | Exit signal |
|-------|------|--------|-------------|
| C0 | **Axxium — the axioms: identity + the fundamental contract shapes** | ⬜ foundational | Axxium (`packages/axxium`) is *identity in the broadest possible sense* — it aligns **user, agent, actor, and contract** identities — and it describes the most fundamental shapes of the contract meta-pattern. **They are our axxiums (axioms).** Concretely: all three systems accept the same API key + OAuth credentials through it (actor/entity registries, sessions, OAuth provider). Abstractly: it is the shared *shape substrate* every interpreter builds on — so this phase absorbs the former "shared interpreter shapes." Underpins everything below. |
| C1 | **Provider-call protocol contracts** (epic 23) | ⬜ proposed | Calling an OpenAI-style provider (chat, embeddings, …) is described as EDN contracts + a contract-understanding client; proxx consumes it internally; the same contracts work from a client without proxx. First target: embeddings (the gap found 2026-06-07). |
| C2 | **Stop using OpenPlanner's API internally** | ⬜ proposed | knoxx (and other internal callers) reach memory/sessions/events through the ledger + contract client, not `/v1/*` HTTP. OpenPlanner's API stays up for external use only. Couples tightly to event-ledger M5. |
| C3 | **Epistemic kernel — agent-interaction contracts** | ⬜ not broken down | The `.eta-mu` epistemic kernel made first-class: primitives `fact / obs / inference / attestation / judgment` and contract kinds `trigger / policy / tool-call / agent / fulfillment / role`, with the loop `obs → actor-fact → contract → inference → action → attestation → judgment → obs`. OpenPlanner **owns** the kernel (shared `.cljc` Malli schemas, graph/garden views project from it); knoxx loads/executes contracts and reads/writes it; promptdb is filesystem-backed evidence. This is "contracts about interactions with agents themselves." |
| C4 | **proxx logic → openplanner packages** | ⬜ not broken down | proxx's contract interpreters (routing, queue, strategy, provider-call) are published from openplanner as npm packages; proxx imports them. Each solidified shape moves once. |
| C5 | **proxx as thin shell** | ⬜ endgame | proxx is little more than HTTP edge + account/secret handling around imported interpreters. |
| C6 | **eta-mu-sol — the endgame harness** | ⬜ endgame | A full JVM/Clojure system running a proper **asynchronous actor-model** agent harness (`packages/agents/eta-mu-sol`), executing agents under the epistemic-kernel contracts. The runtime the whole contract program is ultimately aimed at. |

C1 is the only phase broken into an epic right now — on purpose. We solidify a
shape before extracting it; we don't pre-build the extraction. C0 (axxium) and C3
(kernel) are foundational and deep enough that they each deserve their own roadmap
before epics — mapped, not pre-built.

## Phase C0 — Axxium: the axioms

Axxium (`packages/axxium`, CLJS) is **identity in the broadest possible sense.** It
aligns four identities that are usually kept apart: **user, agent, actor, and
contract.** And it describes the most fundamental shapes of the contract
meta-pattern — *they are our axxiums (axioms).*

So C0 is two faces of one thing:
- **Concrete:** OpenPlanner, knoxx, and proxx accept the same API key and the same
  OAuth credentials through axxium (actor registry of capability-bearing identities,
  entity registry of pure "who", sessions, OAuth provider) — instead of each carrying
  its own token/tenant notion.
- **Abstract:** axxium is the shared *shape substrate* every interpreter builds on.
  This is why the earlier "shared interpreter shapes" phase folds in here — it was
  never a separate thing. The shapes and the identity layer are **the same thing.**

Why it's foundational: C2 ("stop using OpenPlanner's API internally") needs internal
callers to share an identity at the Mongo/contract boundary. Today's credential
fragmentation is the live symptom — the 2026-06-07 embedding debugging burned cycles
on three different tokens (`PROXX_AUTH_TOKEN`, `EMBED_PROVIDER_API_KEY`, proxx tenant
key) for one logical actor. (See [[verify-service-state-never-assert-down]].)

Not broken into an epic yet — axxium deserves its own roadmap first (what it already
is vs. what the three systems must adopt).

## Phase C3 / C6 — the agent layer (epistemic kernel → eta-mu-sol)

These two are the same arc at different maturity. The `.eta-mu` **epistemic kernel**
(`/.eta-mu/openplanner-epistemic-kernel.sexp`) describes contracts about interactions
with agents themselves — primitives `fact / obs / inference / attestation / judgment`
and contract kinds `trigger / policy / tool-call / agent / fulfillment / role`, run as
the loop `obs → actor-fact → contract → inference → action → attestation → judgment`.
OpenPlanner owns the kernel; knoxx executes it; promptdb is filesystem-backed evidence.

**eta-mu-sol** (`packages/agents/eta-mu-sol`, JVM/Clojure) is the **endgame**: a proper
asynchronous actor-model agent harness that runs agents under those contracts. The
kernel is the language; eta-mu-sol is the runtime that eventually speaks it natively.

## Phase C1 — Provider-call protocol contracts (the gap found today)

The embedding subsystem is currently described *only* as "how it works through the
API" — there is no contract/protocol for **calling an OpenAI-style provider**. The
event-ledger epics don't cover it either. The 2026-06-07 embedding outage
(ollama-lan reachable, but the dedicated embeddings route hardcoded the global
ollama base-url instead of the per-provider policy fact) is exactly the kind of bug
that a described protocol + contract-understanding client would have made
structurally impossible.

→ See **epic 23: Provider-Call Protocol Contracts**.

## The open tension: separate repos vs. monorepo (deliberately unresolved)

These projects are *currently* separate ideas that are all moving toward one thing;
concepts in each relate to concepts in the others. The layout question is a genuine
trade-off, and it is specifically about **managing context with agents**:

- **Separate** keeps each system from drifting — an agent working in proxx doesn't
  pull unrelated parts of knoxx/openplanner into context. Good isolation. **But** it's
  hard to *refer* to overlapping concepts across the boundary, exactly when one
  system's idea is really the other's.
- **Together (monorepo)** makes referring trivial ("this is a reference") — **but**
  agents lose the work-vs-reference boundary: they put things that belong in one place
  into the thing you actually asked for, or they edit the very file you offered *only*
  as a reference. Proximity erases the line between "modify this" and "look at this."

Both failure modes are really one: **the work/reference and ownership boundaries are
social hints, not structural facts** — so agents (me included) blur them.

This roadmap does **not** force that decision, because the contract architecture is
itself the way out: give the overlapping concepts **one canonical home** rather than
merging the repos.

- The shared concepts (axxium axioms / identity, the epistemic-kernel primitives, the
  provider-call protocol) live **once** — as EDN contracts + `.cljc` shapes — and get
  **published as packages** (C4). Separate systems *reference* that home instead of
  re-describing it.
- Then repo layout (monorepo vs. many repos) becomes a *packaging* detail, not a
  forcing function. Systems can stay physically separate for context hygiene while the
  concepts they share are referenceable because they have a single source.

A published/imported contract is structurally **not** an editable sibling — it's a
dependency with an owner. That single move fixes *both* horns at once: separate repos
stop having reference friction (you import the shared concept), and monorepo stops
having the boundary-blur (the reference is an import you don't edit, not a folder next
door). It turns the work/reference and ownership boundaries from social hints into
structural facts — which is the only thing agents reliably respect.

So the answer to "they drift apart but I can't cross-reference" *and* "together, they
get confused about what to edit" is the same: the shared things become contracts with
one home, and everyone imports them. The layout call stays deferred; name the shared
concept and give it a home the moment it's overlapping, regardless of where code lives.

## What this roadmap says explicitly

1. OpenPlanner is becoming the contract home; its API is a secondary planning surface.
2. The three systems keep their public APIs and stop calling each other internally —
   they meet in Mongo and speak contracts.
3. proxx stays separate and keeps growing until its logic is solid enough to extract;
   then it shrinks into a shell around openplanner-published interpreters.
4. Centralize the interpreter *concept* and shared shapes, never a single interpreter.
5. The immediate, concrete focus is C1 (provider-call protocols, starting with
   embeddings) and C2 (stop using OpenPlanner's API internally).

## Parked / related threads (not now — discrete choices later)

- **k8s** — would ease the orchestration this roadmap implies.
- **Hosts**: ollama-lan (192.168.12.68) and the "prod" remote are both ssh-able and
  could run more of these services. See [[direction-env-yaml-to-edn-contracts]].
