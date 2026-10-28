<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# SDK public-contract lint tranche — 2026-10-28

Status: isolated type-contract candidate; Yoga qualification remains pending.
Base source is `7a22f5a7af2b2aa4dd014ee1086e4d64385de224`. Production remains held.

This tranche removes 239 lint warnings from the SDK's public DTO, configuration
and embedding-runtime declarations. Readonly schema annotations pass through
the existing explicit `SdkMutable` / `SdkArray` boundary, preserving writable
public fields, nested records, arrays, methods and inferred scope parameters.
This is type-boundary maintenance, not a claim that runtime objects became
immutable or that these modules have completed their ClojureScript migration.
No domain algorithm, model routing value, cache behavior or provider setting is
changed. Runtime JavaScript syntax trees match the captured parent exactly.

The single documented mapped-type lint exception moves from
`mongo-vector-data.ts` to the leaf `types.ts` module. The former module re-exports
the same aliases for existing consumers. This prevents public DTO declarations
from acquiring MongoDB or Node type dependencies merely to use the boundary.
The `types` subpath gains those two canonical type aliases; the root barrel and
runtime export surface are unchanged. No new TypeScript files, inventory entries,
lint configuration changes or additional suppressions are introduced.

## Parent capture and verification

Before editing, the existing SDK was built and its three declarations and
compiled modules were captured with parent/source hashes. The committed JSON
fixture is pinned at
`82fca0c1517e83aa75805a558a8fbe61a0b34676d8c899261c13adb899fe50b0`.
It retains the parent declarations, JavaScript, 27 legacy export identities and
309 accepted client mutation operations. The consumer code is compiled, never
executed. It contains no credentials, private retrieval excerpts or model output.

The contract suite compares all legacy type/function signatures through the
TypeScript compiler, verifies the export-name set with only the two named type
alias additions, and compiles the frozen mutations. Separate checks preserve
inferred embedding-scope mutation, writable runtime methods and the DTO leaf
dependency boundary. A deliberately readonly BlobRef declaration is rejected by
the actual frozen consumer, establishing sensitivity to that regression.
Executable syntax trees are compared structurally, including operators,
literals, modifiers and declaration flags, with comments/formatting excluded.

| Check | Result |
| --- | --- |
| Changed SDK modules and contract test strict lint | zero errors/warnings |
| Full repository strict lint | zero errors; 7,783 → 7,544 warnings; gate still fails |
| SDK build / root TypeScript no-emit check | passed |
| Full root build including existing CLJS dependencies | passed; zero CLJS warnings |
| Dedicated public-contract suite | 12 tests, covering 27 legacy exports and 309 mutations |
| Inventory | unchanged: 558 active files, 787 entries; no unlisted/stale/invalid entries |
| Yoga | unreachable over the harness-specific direct SSH alias; not qualified |

The five compiled ANN adapter modules retain their prior byte hashes and
combined identity
`2e8cc585b0fcc5a52242d64d804a23bd463ab9b0381bede28a9367146ed48b44`.
The change to the data module is type-only. The old native database evidence
remains historical and no fresh MongoDB run is claimed. The preserved ANN
behavior still distinguishes empty-result replay from real native errors and
from the unproven historical engine cause.

A dependency-discovery container lacked TypeScript. Rather than changing that
production-derived image, the test artifact captures the exact compiler and its
read dependency graph, preserving package symlinks. The resulting approximately
27-MiB test bundle is self-contained, checked locally and mounted read-only into
an owned nonroot worker with no network, one CPU, a memory bound and a timeout.
The compiler operates on declarations and virtual client files; it never starts
the SDK, creates a provider cache or contacts a database/model server.

An early export-name assertion compared compiler symbol order with declaration
source order. Sorting names repaired that test oracle; no SDK behavior was
changed to satisfy it. Review found that the first executable oracle omitted
template token text. It now retains all literal/template payloads and raw
template spelling; negative checks cover the actual captured error template,
regex, bigint and tagged raw-template changes. Initial longer readonly annotations exposed additional
line-length warnings, which were resolved through a scope alias and formatting.
The bounded syntax rewrite is supported by the captured ABI and executable
checks, rather than an unverified repository-wide autofix.

## Holdback and next step

Yoga returned `No route to host` at its configured direct SSH alias. No alternate
harness identity, production restart or host configuration change was attempted.
Exact compiled validation there remains an adoption gate; a Stealth pass cannot
supply that evidence. Independent review and final manifest conditions are
recorded with their actual status in the private qualification report.

No model inference or cloud allocation occurred. The same campaign retains four
conservative reservation units of its original 30-unit cap; this is not measured
billing. Fresh telemetry is required before any allocation. Frozen retrieval and
quote cases, prompts, token settings and the offline renderer/native profile are
unchanged. This tranche is not model, modality, actor or production qualification.

Commands, parent artifacts, traces, reviewed source hashes, manifests, failures,
budget and host records are retained under `ann-followup/sdk-public-contracts-v1/`.
Active source, dependencies and evidence remain protected pending verified
recovery. The primary OpenPlanner checkout and other projects were not included.

Next: validate this exact compiled candidate on Yoga when its authenticated
connection returns, then continue bounded lint repair and the reviewed owned
model-launch/cache/endpoint controller. Keep the existing model admission and
live-token-accounting gates; no merge, deployment, routing change, restart or
production activation is authorized.
