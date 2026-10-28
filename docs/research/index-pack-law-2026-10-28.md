# Portable chunk-packing and offset-cursor laws

The isolated candidate moves chunk-packing transitions, overlap bounds and offset
cursor advancement into CLJC. Native string search/slicing, object construction
and iteration remain in the CLJS boundary. The public SDK contract stays writable.
Twenty warnings were removed: whole-repository strict lint now has zero errors
and 7,484 warnings. The gate remains held and unwaived.

## Parent identity and oracle independence

The exact parent is `16c57038e18954980e5c1db87ae0fde153fdb1d9` on
`codex/ann-empty-recovery-20261026`. Source and fresh transpiled JavaScript were
captured before editing. A private probe exports the original offset helper and
copies the original contiguous packing-loop body into a callable helper, without
changing its statements.

The parent already imports the earlier indexing policy. Its three dependency
links therefore point to the protected `index-batch-law-v1/stage-v3`, rather than
the live candidate. The old policy is pinned at SHA-256
`38228d080f3c9598749a9a2cd848ad01b32fb5a8197c4e3407e1bac43e25a045`;
Turndown and its dependency graph remain pinned too. Review verifies those links
and all 1,173 third-party artifact entries. Parent expectations do not silently
change when the new policy is rebuilt.

The new frozen fixture has 192 indexed packing rows, representing **144 distinct
input tuples**, plus three offset sequences. It covers nonfinite/fractional
limits, repeated and missing chunks, empty strings and UTF-16 fragments. Its
SHA-256 is
`e829cafdb5f9827708209ab788d1ebeda60e91e7681fab7cde0c5ffd8f68f0b8`.
A separately captured full variable-overlap document has SHA-256
`e8ea521cfbb0a68a4076dba093d9e47f1e7a510a8f4b8e3696b538659a5ce3af`.
Its seven chunks and all metadata reproduce from the same pinned parent.
These are synthetic development compatibility examples, not retrieval labels,
model evaluations or independent population samples.

All three prior fixture files remain byte-for-byte unchanged. The old runtime
oracle explicitly removes exactly `chunkText` and `locateChunkOffsets`, using
their captured original statement hashes. Its other **21** statements remain
checked, including the existing literal-change negatives. The former 23-statement
record is retained as historical evidence; its scope is not silently overwritten.

## Preserved behavior and review corrections

The pure layer owns paragraph joining, flush selection, overlap clipping and
cursor advancement. The boundary preserves lazy native comparisons and their
coercion order. Fractional overlap still uses native negative-slice truncation.
Offset lookup still retries from the beginning when its forward search misses,
and a missing range returns two nulls without advancing the cursor. Cursor
advancement retains the historical fixed 400-character default even when packing
uses a different overlap. This tranche preserves that behavior; it does not
claim to improve source-location accuracy.

Independent review found two differences in the first port, both corrected:

- General Clojure-to-JS conversion assigned output properties and could trigger
  inherited setters. The parent uses object literals. Known offset keys now use
  native literals; found and missing ranges both bypass inherited setters while
  remaining ordinary writable objects.
- Overlap arithmetic initially ran before trimming the emitted current chunk.
  The parent trims/emits first. The boundary now preserves that order, including
  numeric-coercion callbacks and the original Error identity on trim failure.

A whole-document test that recomputed expected offsets through the same new
helper was replaced by the independently frozen full parent result. The ABI
consumer was expanded from its prior 21 writes to **30 operations**, including
all prepare parameters and their mutable extra dictionary. The same consumer
compiles against both parent and candidate; separate wrong-field, readonly DTO
and readonly-parameter negatives fail as expected.

## Checks and exact host artifact

| Check | Result |
| --- | --- |
| Combined compiled indexing suites | 19 methods pass locally and on Stealth |
| Frozen parent evidence | 128 previous batch cases, 10 estimates, 192 packing rows, 3 offset sequences, 7 documents match |
| SDK public contracts / mutable operations | 5 contracts / 30 operations pass |
| Unmigrated runtime statements | 21 original AST hashes match |
| Portable laws, BB and NBB separately | 4 tests / 20 assertions each pass |
| New JS source/test strict lint and clj-kondo | zero errors/warnings |
| Prior focused SDK/ANN/ranking/model-policy suites | 43 methods pass |
| SDK/full root build and root no-emit typecheck | pass; zero CLJS build warnings |
| TypeScript inventory | 558 active / 787 entries; passes, unchanged |
| Edited SDK indexing module | 33 → 13 existing warnings; zero errors |
| Full repository strict lint | exit 1, 7,504 → 7,484 warnings; zero errors; held |
| Yoga | direct harness alias returned No route to host; unqualified |

The final artifact is `ann-followup/index-pack-law-v1/stage-v2`. Its manifest has
1,189 file/symlink entries and binds compiled SDK/policy, declarations, tests,
fixtures, TypeScript and actual Turndown dependencies. The worker verifies every
entry and returns the compact manifest digest/count. Final Stealth qualification
uses Node 22.22.2/TypeScript 5.9.3, UID/GID 1000, no network, read-only mounts, one
CPU, 768 MiB, 64 PIDs and inner/caller timeouts. Its exact container absence is
verified. The preliminary stage-v1 pass remains retained with its narrower ABI
consumer; it is not substituted for the final artifact.

Codex's direct SSH requester is attributed as loginuid 1002 with sudo err
execution. Docker daemon child attribution is not inferred from that identity.
No database or model endpoint is contacted. The five ANN adapter compiled files
retain combined identity
`2e8cc585b0fcc5a52242d64d804a23bd463ab9b0381bede28a9367146ed48b44`.
No native MongoDB run was repeated. Captured ANN replay, observed native failures
and the unproven historical engine cause remain separate.

## Holdback, budget and next work

The remaining indexing warnings belong to unported hard splitting and HTML
boundaries. Public interfaces were not converted to aliases; no new TypeScript
file, lint exception or waiver was added. The existing mutable SDK boundary and
its original compile fixture remain. This is partial indexing migration, not
runtime immutability or production readiness.

No model load/download, inference or Colab allocation occurred. The original
30-total-unit campaign still carries four conservative reservations, not measured
charges; state bytes are unchanged. Fresh usage/assignment evidence is retained
privately and must be refreshed before allocation. Retrieval/quote cases, prompts,
model identities, heuristic interpretation and offline native token profile are
unchanged. Compatibility examples do not establish model, modality, live context
retention, actor or production qualification.

Commands, parent/dependency identities, failures, source review, host manifests,
cleanup and budget records are retained under `ann-followup/index-pack-law-v1/`.
All current and previous pending Yoga artifacts remain protected; no scratch was
reclaimed and verified private recovery is pending Yoga. The primary checkout
and other projects' dirt were excluded.

Next: continue a bounded remaining SDK policy tranche and prepare the separately
reviewed owned model cache/backend/launch and live-token profile. Qualify exact
pending artifacts on Yoga when authenticated direct SSH returns. Preserve the
model-bytes-plus-2-GiB CPU guard, shared-inference prohibition, fresh admission
and production holdback before the frozen smoke. No merge, deployment, restart,
model routing or activation is authorized, and no cloud/GPU admission is granted.
