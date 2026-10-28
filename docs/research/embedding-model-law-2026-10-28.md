# Embedding model parsing and selection: bounded portable-law tranche

The isolated candidate extracts the SDK's existing embedding-model configuration
parser and scope precedence into a small CLJC law with a CLJS boundary. The
synchronous TypeScript API remains a bridge with writable public DTO contracts.
This removes 12 migration warnings; repository strict lint still fails on 7,532
warnings, with zero errors. The remaining backlog has no waiver.

## Source and behavior evidence

The exact parent is `eb3b5f4f47e5dafb076d9799e11a042e381e6975` on
`codex/ann-empty-recovery-20261026`. Before changing it, its source and freshly
compiled JavaScript were captured privately. The public fixture fixes seed
`0x20261028`, 208 ordered parser examples and 128 scope-resolution examples,
including malformed JSON, duplicates, numeric ordering, Unicode whitespace,
falsy values and inherited properties. Its SHA-256 is
`2d5118dab903c6077f99d7d4c0f77124b98f10d53f6664a906de256c31526e89`.
These are synthetic compatibility examples derived from the parent, separate
from the frozen 24 retrieval cases and eight quote cases.

The CLJC layer owns trimming, pair validation and precedence. JSON decoding,
ordinary JavaScript property assignment, native truthiness and lazy property
reads stay at the boundary. Existing behavior is deliberately retained: project
beats source, then kind, then default; all scope strings normalize before map
lookup; later map getters remain lazy. Inherited values and `__proto__` assignment
behavior are compatibility facts, not a new configuration-security guarantee.

Independent review found a catch-extent regression: the first extraction caught
JSON decoding but omitted assignment failures. The parent catches both and then
falls back to pair parsing. The corrected boundary includes validation and
materialization in the JSON catch. A throwing inherited setter now verifies
JSON fallback and propagation of a pair-assignment failure. The preliminary
nine-method artifact and records remain available; final evidence binds the
corrected ten-method artifact `embedding-model-law-v1/stage-v3`.

## Verification and packaging

| Check | Result |
| --- | --- |
| Frozen parent replay plus explicit boundary contracts | 10 JavaScript methods pass |
| Portable CLJC laws, Babashka and NBB separately | 2 tests / 13 assertions each |
| clj-kondo | zero errors/warnings |
| Changed-source strict lint | zero errors/warnings |
| Repository strict lint | zero errors; 7,544 → 7,532 warnings; gate held |
| SDK and full root build, including CLJS dependencies | pass; zero CLJS warnings |
| Root TypeScript no-emit check | pass |
| Existing ANN, ranking and public-mutation suites | 33 methods pass |
| TypeScript inventory | unchanged: 558 active / 787 entries |
| Stealth | exact compiled manifest, 10 methods, nonroot/no-network worker; cleanup verified |
| Yoga | direct harness SSH unavailable; qualification pending |

The new workspace package has a generated declaration boundary and a declared
SDK runtime dependency. Its compiled ESM exports were imported and checked as
callable functions. The SDK build invokes the policy build before TypeScript.
The lock change adds only the workspace link and its already-pinned Shadow CLJS
importer; no dependency version changed. A filtered, frozen, offline install
passed with resolution skipped. Earlier broad/offline resolution attempts
failed on unavailable cache metadata/tarballs and are retained; no claim is made
that a fresh whole-workspace offline install passes.

The owned Stealth worker mounts the compiled bundle, test, fixture and manifest
read-only, verifies each hash and symlink, runs as UID/GID 1000 with no network,
and has memory/CPU/PID/time bounds. The launcher pins the test import to the
manifest-bound SDK bridge even when an inherited module override points to a
nonexistent target; the host run exercises that negative explicitly. Exclusive
stage creation also rejects reuse under optimized Python without changing bytes. The requester SSH identity is UID/loginuid
1002 with sudo execution as err/1000. This does not attest Docker child audit
identity. No database or model endpoint is contacted by this compatibility test.
The five ANN adapter compiled files remain byte-identical to the prior combined
identity `2e8cc585b0fcc5a52242d64d804a23bd463ab9b0381bede28a9367146ed48b44`;
no new native MongoDB run is claimed.

## Budget, ownership and remaining gates

No inference, model loading/download or Colab allocation occurred. The original
30-unit campaign still carries four conservative reservation units; these are
not measured charges. Its state bytes are unchanged. Fresh 10:19 UTC telemetry
showed balance 399.54, zero rate and assignments, with an empty direct assignment
list. Refresh usage and direct assignments before any allocation. The frozen quote
fixture, prompts, retrieval settings and pinned offline token profile did not
change. Offline token preflight does not establish live context retention,
answer quality, modality or actor suitability.

All current private evidence and dependencies remain protected under
`ann-followup/embedding-model-law-v1/`; Yoga recovery is pending and no scratch
was reclaimed. The previous `sdk-public-contracts-v1/stage-final` and its reviewed
runner remain separately protected for their pending Yoga qualification.
The primary checkout's dirt and other projects were not included.

Next: qualify both exact pending artifacts on Yoga when authenticated direct SSH
returns, while continuing the bounded lint backlog and owned model-controller
work. A real model launch still needs reviewed cache/endpoint ownership, fresh
resource admission and live token accounting. Keep candidates isolated; no
merge, deployment, restart, production model load/unload, routing change or
activation is authorized, and this tranche grants no cloud/GPU admission.
