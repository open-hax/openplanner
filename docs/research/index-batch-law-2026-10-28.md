# Portable indexing-batch law with the SDK contract preserved

The isolated candidate moves indexing-batch transitions, defaults and token
estimation into a CLJC law. A small CLJS boundary retains native JavaScript
iteration, limit coercion and output objects. The existing SDK functions remain
synchronous, and its public DTOs, nested arrays and option types stay writable.
This removes 28 warnings: repository strict lint is now zero errors and 7,504
warnings. The gate remains held and has no waiver.

## Exact parent and controlled behavior evidence

The parent is `b5b37604f4f8967f60c2cda041ecbdabcec948a8` on
`codex/ann-empty-recovery-20261026`. Before edits, the phase captured its source
and freshly transpiled JavaScript. A private probe appends only an export of the
existing internal estimator. Independent review reproduces both captures from
the exact Git parent.

Three public compatibility fixtures preserve distinct evidence:

- 128 fixed parent-derived batch cases and 10 token examples, SHA-256
  `10a8d7cdd25a159bf965db8280f899f720c8b147fcae289715d6cd2a2fe1b09e`.
- The parent declaration and 23 unaffected runtime statement hashes, SHA-256
  `d539404c79bae7018be4e32e38cddf4a95265f134e2b24174632edfff8b7f489`.
- Six whole-document preparations from the same stored parent, covering empty
  text, Unicode whitespace, sentence splitting, long-block offsets, HTML and an
  extra HTML source. These extend compatibility coverage to consumers of the
  extracted estimator. They are development checks, not locked research cases.

The batching law owns the immutable count/token transition and flush decision.
The estimator law uses native string facts to compute the same whole-number
estimate: max(ceil(native UTF-16 length / 4), ceil(word count × 1.35)).
This remains a character/word heuristic, not E4B or EmbeddingGemma tokenization,
live context retention or admission telemetry. The boundary performs limit comparisons lazily with native JS
semantics, retaining NaN/Infinity, coercion and short-circuit ordering. It retains
all input object identities and includes a single oversized item rather than
silently dropping it. A generic native iterator primitive is necessary to keep
IteratorClose and error ordering; no batching decision lives in that loop.

An initial Array.from adapter introduced an unnecessary intermediate array and
looked up the iterator function's `.call` property. Review reproduced a mismatch
when a valid iterator has its own noncallable `.call`. The final native iterator
primitive fixes both problems. A parent-backed regression retains that case.
An initial test compared the decorated input array itself with a fresh batch
array; the parent also creates fresh containers. The corrected oracle checks
container counts and element identity. Preliminary failures remain private.
The first JVM law test also distinguished integral and floating Clojure values;
the JVM ceiling now returns a whole long, matching its token-count domain.

## Verification and remaining lint

| Check | Result |
| --- | --- |
| New compiled behavior and ABI suite | 9 methods pass locally and on Stealth |
| Parent batches / token estimates / full documents | 128 / 10 / 6 match |
| Five public exported contracts | exact compiler comparison passes |
| Writable DTO, nested array, batch and options client | 21 mutation operations compile |
| Wrong-field-type and readonly sensitivity negatives | each rejected separately |
| Unaffected runtime statements | all 23 parent AST hashes match; numeric/regex negatives detected |
| Portable CLJC laws, BB and NBB separately | 2 tests / 9 assertions each pass |
| New JS source/test strict lint and clj-kondo | zero errors/warnings |
| Existing focused contract/ANN/ranking/model-policy suites | 43 methods pass |
| SDK build, full root build and root no-emit typecheck | pass; zero CLJS build warnings |
| TypeScript inventory | 558 active / 787 entries; passes, unchanged |
| Edited SDK indexing module | 61 → 33 warnings, zero errors; existing backlog remains |
| Repository strict lint | 7,532 → 7,504 warnings, zero errors; held |
| Yoga | direct harness alias returned No route to host; unqualified |

The source schemas use the already documented `SdkMutable`/`SdkArray` boundary;
no new exception or rule change was introduced. No public interface was converted
to a type alias, and the MongoDB interface/declaration-merging concern remains
separate. These annotations do not make runtime DTOs immutable or complete the
indexing/domain migration. Remaining loops, HTML conversion and other indexing
logic retain their old implementation. Their runtime syntax is checked against
the parent, including literal and template payloads.

The new workspace package is an explicit SDK dependency. SDK builds its policy
before TypeScript. The lock adds only its workspace importer/link with the
already-pinned Shadow CLJS version; a filtered frozen offline install passes
without resolution or dependency-version changes. Actual compiled ESM exports
were imported and called after compilation.

## Host identity, artifact integrity and cleanup

The final exact artifact is `ann-followup/index-batch-law-v1/stage-v3`. It bundles
the compiled SDK module, generated policy/declarations, fixtures and tests,
TypeScript and the actual Turndown dependency graph. Its manifest covers 1,186
file/symlink entries. The worker checks every entry and returns the manifest
SHA-256 and count, rather than printing the entire manifest.

The first two host checks could not parse a metadata line truncated near 64 KiB;
the exact truncation mechanism is not established. Their raw outputs/stages are
retained and are not final qualifications. The compact manifest receipt fixes
the observation path. The runner persists an attempted container identity before
launch and checks cleanup in a finally block, including parsing failures. A
scoped readback also found no remaining containers under this phase's owned
prefix after the earlier attempts.

The final Stealth worker passes all nine methods under Node 22.22.2 and
TypeScript 5.9.3, UID/GID 1000, no network, read-only mounts, one CPU, 768 MiB and
64 PIDs, with inner and caller timeouts. Its exact container absence is verified.
The requester is the Codex direct SSH identity UID/loginuid 1002, with sudo err
execution. Docker daemon children are not claimed to inherit that audit identity.
The test starts no database or model connection.

All five ANN adapter compiled files remain unchanged at combined identity
`2e8cc585b0fcc5a52242d64d804a23bd463ab9b0381bede28a9367146ed48b44`.
No native MongoDB run was repeated. Previously captured empty-ANN replay,
observed native failures and the unproven historical engine cause retain their
separate evidence tiers.

## Budget, preservation and next experiment

No model inference/load/download or Colab allocation occurred. The same original
30-total-unit campaign carries four conservative reservation units, not measured
charges. Campaign bytes remain unchanged; fresh telemetry is required before
any allocation. Frozen retrieval/quote cases, prompts and the offline token
profile did not change. Batch compatibility is not model, modality, live context
retention, actor or production qualification.

The private phase retains commands, captures, failures, stages, source review,
host records, budget and cleanup evidence. All current and previous pending Yoga
artifacts remain protected; no scratch was reclaimed and remote recovery is
pending Yoga. The primary checkout and other projects' dirt were excluded.

Next: qualify the exact pending candidates on Yoga when its authenticated direct
connection returns; continue remaining indexing policy extraction and the real
managed synthetic-listener/controller/preflight join. Keep the owned model
cache/backend, request-time identity, live token accounting and fresh resource
admission gates before the frozen two-case smoke. No merge, deployment, restart,
model routing or production activation is authorized, and this tranche grants
no cloud/GPU admission.
