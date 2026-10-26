<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Native ANN empty-result investigation and isolated recovery candidate

Operator request, 2026-10-26: investigate the eight empty ANN results, fix the
cause, remain isolated until tested on Stealth and Yoga, and retain the same
30-unit Colab campaign. Linked research card:
`qualify-the-bounded-colab-gemma-retrieval-research-pilot-and-retain-production-holdback`
in Foresight's Rheos board. No production activation is authorized by this plan.

## Evidence and scope

The frozen October25 native ANN trace has eight zero-chunk responses. Fresh
identical October26 requests now return candidates for all24 queries. Filter
ablations and native execution plans also return results. Do not claim that an
unreproduced historical Lucene/HNSW event has a proven internal engine cause.

The SDK currently treats a successful empty ANN response as authoritative. It
only recovers on exceptions, so an ANN miss can be reported as no memory despite
matching records and successful exact search. This client behavior is directly
reproducible from the captured responses. The candidate addresses that gap in
the owning SDK; it does not change Knoxx or production infrastructure.

## Planned behavior and acceptance

1. Preserve the existing ANN path and filters for nonempty results.
2. For empty ANN results, check whether the *same filtered partition* has records.
   A genuinely empty scope returns empty without broadening any filter.
3. If records exist, retry native exact search with the same query vector, index,
   filter and result limit. Exact requests must omit `numCandidates`.
4. If exact search also yields no candidates, raise an explicit inconsistency
   error; never turn an unhealthy populated index into authoritative no-memory.
5. Preserve existing thrown-error behavior outside the new recovery path, and
   preserve model/dimension partitions, hydration and provenance.
6. Test captured-empty replay, ordinary nonempty ANN, truly empty filters, missing
   indexes, exact-search errors and tenant/project/model isolation.
7. Exercise native candidate databases on Stealth and Yoga with the frozen corpus,
   plus real missing-index/readiness failures. Record replay injection separately
   from genuine native database results. Never alter production collections,
   index definitions, running SDK files or services.

No new Colab allocation is required for local database failure isolation. The
existing campaign remains charged4 of30 conservative reservation units; it must
not be reinitialized if remote compute becomes necessary.

## Initial candidate verification (before gate repair)

The compiled candidate SHA-256 is
`a8711517eedcfab97997ede0b62f99ffbbc5fdab8173b6a131583eb2ae56fc84`.
The same compiled SDK artifact passed native checks on Stealth (MongoDB8.2.7)
and Yoga (MongoDB8.3.4). Each host seeded4,638 frozen creative vectors plus a
wrong-project canary in a unique `colab_ann_01a1722a_*` candidate database.
No production collection, index or running SDK was changed.

Each native run established:

- All24 healthy queries preserved the unmodified SDK's result IDs.
- Replaying the eight recorded empty ANN responses caused the old SDK to return
  empty and the candidate to recover through real native exact search. The ANN
  response replay is an explicit injection, not a reproduced HNSW engine event.
- A genuine missing-index query against the populated candidate database produced
  a silent empty response in the old SDK. The candidate returned an explicit
  inconsistency error. This is a demonstrated index-readiness/identity failure
  mode, not evidence that the historical eight had that particular cause.
- A genuinely empty project remained empty, recovery retained source/project
  filters, and a perfectly similar wrong-project canary did not escape.
- Both owned databases were dropped and absence was verified.

Yoga's normal application credential correctly refused access to a new database
before any fixture creation. The successful candidate run used Yoga's existing
local database administrator, confined by the verifier to the new candidate
namespace. No database role or application credential was changed; credentials
were passed only through local process memory and never copied between hosts.

The six focused regression tests pass, including exact-error propagation,
existence/ENN time bounds, and preservation of the old thrown-error fallback.
The existing embedding/model/vector test set adds19 passing tests. The SDK
TypeScript build and its two CLJS dependency builds pass; dependency builds
reported zero compiler warnings. The new verifier/test files lint with zero
warnings and errors. No new warning occurs in the new recovery helper.

The repository's broader quality baseline is not green: the existing SDK file
has218 lint warnings before and213 after this patch, with no lint errors. The
no-new-TypeScript inventory check fails with identical output on the original
and candidate source; no TypeScript file was added. Those baseline problems
remain adoption gates, not approval waivers. No board `done`, merge, deployment,
full-repository green, or production-readiness claim is made.

## Human reproduction

Run in the isolated candidate worktree on Stealth. The frozen corpus and
credentials remain private and are not committed with this SDK patch.

```sh
pnpm install --filter @open-hax/openplanner-sdk... --frozen-lockfile --ignore-scripts
pnpm --filter @open-hax/openplanner-document-hydration... build
pnpm --filter @open-hax/openplanner-sdk build
node --import tsx --test tests/mongo-vector-empty-recovery.test.mjs
node --import tsx --test src/tests/vector-search.test.ts src/tests/embedding-models.test.ts src/tests/embeddings.test.ts
pnpm exec eslint tests/mongo-vector-empty-recovery.test.mjs scripts/verify-native-ann-recovery.mjs --max-warnings 0
```

The task's private host adapter prepares the original SDK baseline module from
Git, packages the fixed corpus and runs `scripts/verify-native-ann-recovery.mjs`
in an owned non-root, read-only worker container on each host. It passes the
host-local Mongo credential on stdin; neither it nor the verifier prints the
credential. The verifier checks its namespace, seeds its own data and canary,
waits for a queryable native index, exercises the happy/failure paths, then
removes only its owned candidate database in `finally`.

Private runnable adapter and retained evidence:
`/home/err/.local/share/promethean/research/colab-gemma-20261025/ann-followup/`.
The fixture and original-SDK module must be prepared before running that adapter;
these are fixed research inputs rather than public package assets.

```sh
python3 /home/err/.local/share/promethean/research/colab-gemma-20261025/ann-followup/verify_host.py stealth
ssh -o BatchMode=yes -o ForwardAgent=no yoga-agent-codex 'sudo -n -u err python3 /home/err/.local/share/promethean/research/colab-gemma-20261025/ann-followup/verify_host_gate.py yoga'
```

Reports `native-stealth.json` and `native-yoga.json` retain server version,
candidate artifact hash, query IDs, native-versus-replayed modes, recovery filter
requests, real missing-index rejection and independent cleanup readback. These
checks qualify this isolated SDK candidate; they do not qualify E4B latency,
quote fidelity, native Yoga embedding generation, or production actor behavior.

The same Colab campaign state remains in place with4 reserved units of30 and
no new allocation for this investigation. Production adoption remains disabled.


## Gate-repair continuation, October 26

The subsequent [gate-repair report](ann-gate-repair-2026-10-26.md) supersedes the
initial SDK lint and inventory status above. The refactored adapter is strictly
clean, inventory passes, 34 tests and the full root build pass, and both hosts
verified the same five-file compiled adapter. Whole-repository strict lint still
fails on 7,814 warnings outside this adapter. Production remains held.
