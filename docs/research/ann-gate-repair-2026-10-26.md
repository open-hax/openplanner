<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# ANN recovery gate repair — 2026-10-26

Status: isolated candidate verified; repository-wide strict lint remains an adoption blocker.
Branch: `codex/ann-empty-recovery-20261026`, following recovery commit
`398d2582e33f453ca0f644981c8e418ec7d7c0aa`. No production activation or merge.

## What ANN means here

ANN is approximate nearest-neighbor retrieval in MongoDB Vector Search, using
an HNSW index over existing EmbeddingGemma vectors. The evaluated partition is
768-dimensional cosine similarity. This work changes OpenPlanner's response to
an empty approximate search; it does not train a neural network, change the
embedding model, or replace the index algorithm. The historical eight empty
responses remain captured symptoms, with their internal engine cause unproven.

## Repairs

The former 1,322-line vector adapter is split into document conversion/filtering,
partition/index management, transactional writes, retrieval/recovery, and the
existing public facade with batch indexing. The new files extract existing
TypeScript runtime seams; they are not a new domain implementation. Their T2
migration ownership explicitly requires replacing the bridges with CLJC law and
CLJS runtime adapters while retaining consumer contracts.

The implementation uses readonly inputs and smaller helpers, preserving
sequential MongoDB transaction operations, session cleanup, query caches,
metadata defaults, redaction, legacy partial batch behavior, and ANN recovery.
The public SDK's existing mutable properties and arrays remain compatible.
A single documented lint exception on the `-readonly` mapped type preserves that
public API; a compile-time consumer fixture exercises actual mutations. There
is no repository lint configuration change, global warning waiver, or change to
the inventory gate's acceptance logic.

Independent review caught both a public mutability regression and a synchronous
embedding-error regression in an intermediate refactor. Both were corrected;
regression tests cover synchronous failures and existing mutable consumers.

Inventory reconciliation records 22 SDK files already introduced by extraction
commit `5cbc8f200181114750e7f6e824309ed82e938c65`, plus four adapter seams from
this refactor. All 26 entries have explicit owner, disposition, provenance and
removal condition. It retains 229 historical entries as removed, with evidence:
228 belonged to the Knoxx submodule removed in that extraction, and one was the
Turndown declaration relocated into the SDK. They are not active allowances.
Explicit `node:process` and `node:console` imports fix the checker's 20 ESLint
errors without changing its behavior.

## Verification

| Check | Observed result |
| --- | --- |
| Strict lint: five vector adapter files, checker, native verifier, two regression files | 0 warnings, 0 errors |
| No-new-TypeScript inventory | 558 active files, 787 historical/current entries; 0 unlisted, stale or entry errors |
| Existing embedding/model/vector and ANN tests plus adapter contracts | 34 passed, 0 failed |
| SDK TypeScript build | passed |
| Root build, including Garden and four CLJS dependencies | passed; CLJS builds reported 0 warnings |
| Root TypeScript no-emit check | passed after building the existing Garden dependency |
| Whole-repository strict lint | 0 errors, **7,814 warnings: still fails** |
| Native Stealth / Yoga | same compiled adapter; both passed the checks below |

The compiled adapter identity is the SHA-256 of the verifier's ordered JSON map
of all five compiled adapter file hashes:
`2e8cc585b0fcc5a52242d64d804a23bd463ab9b0381bede28a9367146ed48b44`.
The verifier records the individual hashes as `candidate_files`; comparing only
the public facade would not identify the extracted retrieval implementation.
The original baseline module is built from `582efb7`, not the now-patched HEAD.

Both Stealth MongoDB 8.2.7 and Yoga MongoDB 8.3.4 used a unique owned candidate
database, 4,638 frozen vectors, and a wrong-project canary. Each established:

- 24/24 healthy query result ID sets unchanged against the original SDK.
- 8/8 captured empty ANN responses recovered through real native exact search.
  ANN response injection remains explicitly labelled replay.
- A real missing-index silent-empty result rejected as an inconsistency.
- Legitimate empty scope preserved and wrong-project canary excluded.
- Owned candidate database dropped, with absence independently read back.

A first Yoga launcher attempt could not read the transferred archive across the
Codex account's private home. Its worker failed module loading before database
creation. The archive was then installed with explicit ownership into the owned
research directory, and the successful native run completed. No account/home
permissions, application credentials, database roles, or production data changed.
Both host operations used the Codex SSH identity, UID/loginuid 1002, transitioning
to the existing host workspace owner for the bounded worker. The actual worker
container ran as UID/GID 1000 with read-only mounts and dropped capabilities.

Private detailed evidence remains under
`/home/err/.local/share/promethean/research/colab-gemma-20261025/ann-followup/`,
including `gate-repair-native/native-{stealth,yoga}.json`, build/test/lint logs,
`typescript-gates-repaired.json`, and `budget-gate-repair.json`.

## Remaining gates and continuation

The repaired adapter has no implementation lint warnings. The full repository
still has 7,814 warnings elsewhere; largest groups include the existing graph
route, MongoDB adapter, graph packages and SDK types. This is a wider migration
backlog, not a reason to suppress strict lint or mark this work done. Follow-up
repair must use bounded, reviewed changes and rerun the affected behavior tests.
No full test-suite or production-readiness claim follows from the 34 focused
tests. E4B quote fidelity/latency, native Yoga embedding generation and production
actor verification remain separate research qualifications.

The app heartbeat `continue-bounded-knoxx-colab-research` resumes this same chat
every two hours, continues bounded gate repairs and workload-specific research,
and writes dated reports for meaningful stages. It retains the production
holdback and stops compute if usage cannot be verified or the cap is exhausted.
It does not authorize merge, deployment, service restarts or model routing changes.

The same campaign `colab-gemma-2026-10-25` remains conservatively charged **4 of
30 compute units**. This stage allocated no Colab runtime. Fresh 17:30 UTC usage
showed zero usage rate and zero assignments; the direct assignment list was
also empty. Reservations are not a claim of measured 4-unit billing. The cap
must never be reset between continuation runs.

Next bounded step: reduce a small existing lint tranche with its own behavior
checks; retain the wider repository gate as failed until it actually passes.
