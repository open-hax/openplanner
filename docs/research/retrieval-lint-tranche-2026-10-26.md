<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Tiered retrieval compatibility and lint tranche — 2026-10-26

This bounded continuation follows commit
`11a22b07a96683ccf7672cb7ba137fd73ff519e0` on the isolated
`codex/ann-empty-recovery-20261026` branch. Production remains held.

## Change and scope

The existing SDK `vector-search.ts` combines hot and compact search results,
groups chunks by their parent source, and applies reciprocal-rank fusion. Its
31 lint warnings are repaired by readonly internal records, ordered reducers,
and explicit per-parent updates. The ranking formula, representative selection,
metadata precedence, first-encounter tier order and public mutable SDK types
are preserved. There are no new TypeScript files, inventory allowances, lint
suppressions, model changes or ranking parameters. This purifies the existing
TypeScript bridge ahead of a possible portable-law extraction; it does not
introduce a replacement domain authority.

The existing documented public SDK mutation type helper is imported only as a
type. The compile fixture now also mutates `TieredVectorHit` properties and its
returned hit array, preserving existing consumer compatibility.

## Evidence

| Check | Result |
| --- | --- |
| Strict lint of the changed SDK utility and both contract test files | 0 errors, 0 warnings |
| Full repository lint inventory | 0 errors; warnings reduced from 7,814 to **7,783**; strict lint still fails |
| SDK build and root TypeScript no-emit check | passed |
| Focused retrieval, embedding, ANN and adapter contract tests | **40 passed**, 0 failed |
| Frozen synthetic ranking compatibility | 192 cases match exact parent behavior |
| Compiled utility checks on Stealth / Yoga | each passed 6 tests covering the 192 cases and adverse contracts |
| No-new-TypeScript inventory | unchanged: 558 active files, 787 entries; no unlisted, stale or invalid entries |

The frozen synthetic fixture records parent commit, parent source SHA-256 and
selection seed `0x02601026`. It was generated from that exact parent's compiled
utility, then independently checked against the parent source during review.
These are ranking regression inputs, not additional real retrieval cases or
new model relevance labels. The 24-case development/validation/locked splits
and previous model scores remain unchanged.

Additional hand-authored contracts exercise better chunks with empty text,
equal-distance first selection, representative metadata replacement, tier order,
rank/distance/identity ties, nonpositive limits, malformed nested responses and
input immutability. Independent review also checked 49 raw combinations of
undefined, null, NaN and infinite distances against the parent implementation;
those ad hoc comparisons are separate from the committed 40-test suite.

Both host workers executed the exact compiled utility SHA-256
`054d3e2edefbd3e76ac0bb506bfbe91a82b30571e7e086956b32249366c5ea4f`
under Node 22.22.2 as UID/GID 1000. Each worker verified its module, fixture,
test and launcher hashes before executing. Containers used read-only mounts,
no network and dropped capabilities; their absence was read back after exit.
Codex's SSH login identity was verified as UID/loginuid 1002 on both hosts.
No host credential, database or production service was used for these checks.

A launcher invocation through `../run-tiered-hosts.py` initially left an
unresolved parent path in Yoga's mount source. Docker rejected the mount before
the test worker started. Resolving the launcher's own path before constructing
host paths corrected it; the successful Yoga run verifies the current artifact.
No host permission or production change was needed.

The five compiled files of the previously qualified ANN recovery adapter retain
their exact prior hashes and combined identity
`2e8cc585b0fcc5a52242d64d804a23bd463ab9b0381bede28a9367146ed48b44`.
This stage verifies the tiered ranking utility on both hosts. It does not claim
a fresh native MongoDB test; the unchanged adapter's prior native evidence stays
bound to its recorded artifact identity.

Private logs, host results and qualification are under the campaign's
`ann-followup/` directory, including `tiered-{stealth,yoga}.json`,
`tests-tiered-retrieval.txt`, `eslint-repository-tiered-retrieval.json`,
`typescript-tiered-retrieval.json` and `budget-tiered-retrieval.json`.

## Budget and holdback

This stage allocated no Colab runtime. The original campaign is still charged
4 of its 30 units as conservative reservations, not measured billing. A fresh
19:19 UTC check found zero usage rate and no assignments; the direct assignment
list was also empty. The campaign state bytes were unchanged by the check.
The app heartbeat continues the same campaign and preserves the production
holdback. The 7,783 remaining repository warnings have not been waived, and the
broader task is not marked done.

## Next research experiment

Keep lint repair bounded while preparing a versioned E4B quote-fidelity and
latency experiment. The October 25 pilot found one exact-quotation failure among
two Stealth candidate-retrieval answers, while Yoga produced partial output but
no complete answer within its deadline. Those are different qualification gaps.

The next proposal should freeze development/validation source excerpts and
expected exact quote spans before execution. Compare the existing prompt with
one fixed evidence-extraction-first prompt, using the same retrieved context,
model digest, quantization, sampling settings and output budget. Record cold
load, first visible text, completion, cited source identity, exact substring
fidelity and abstention separately. Do not score incomplete Yoga responses as
answer-quality failures or use locked cases to choose the prompt. Run a bounded
local smoke first; allocate cloud compute only for a versioned job that passes
the existing campaign law, fresh usage, runtime ownership and cleanup checks.
This is a proposed next experiment, not a new result or adoption decision.
