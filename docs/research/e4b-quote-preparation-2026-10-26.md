<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# E4B quote-fidelity preparation — 2026-10-26, 21:47 UTC

Status: versioned private fixture and portable laws verified on Stealth and Yoga.
No model inference was run. Production remains held. This continuation follows
`3021d41115342ae092509bab768e9db174a03a8c` on the isolated ANN candidate branch.

## Frozen comparison

The new [protocol](e4b-quote-v2/protocol.edn) and
[reproduction guide](e4b-quote-v2/README.md) compare the existing RAG prompt with
one fixed evidence-extraction-first instruction. Question, source order, source
text, model digest, Q4_K_M quantization, sampling and output budget are identical
within a pair. Order is balanced within each split before observing model output.
No new retrieval grid or adaptive prompt search was executed.

The private fixture SHA-256 is
`83ecc2b40e95ca273c47b13225462f04d1148ca1ee78fcf28992c9f1b59a0408`.
It contains eight text cases: four development and four validation, with no
locked, image or audio cases. It reuses the fixed raw/512/fusion-0.5 candidate
source lists, rather than changing retrieval while comparing prompts. Each case
retains the first 1,500 characters of five source chunks and their hashes.
Five cases include the labeled source anchor in the supplied context; three do
not. That context limitation is reported separately from prompt behavior.
Labels remain provisional and source-level; they are not a broad answer oracle.

One lyrics and one lore development case form the proposed smoke, with opposite
prompt order and visible labeled support in both contexts. Two cases would
establish execution behavior only. The full experiment must report development
and validation counts separately, including attempt and valid-completion
denominators; it cannot claim general improvement from a tiny selected subset.

## Verification and corrected findings

| Check | Observed result |
| --- | --- |
| Portable law suite | 8 tests, 69 assertions; zero failures/errors |
| clj-kondo on all new Clojure sources | zero errors/warnings |
| Frozen fixture hash and excerpt hash validation | passed |
| Stealth and Yoga | same source/fixture manifests; each passed the law suite and fixture admission |
| Private file creation | mode 0600 observed before the first write under umask 022 |
| Existing frozen output | overwrite refused |
| Optimized Python (`-O`) | tampered case identity rejected before output creation |
| Python adapter syntax | passed |
| TypeScript inventory | unchanged, passing: 558 active files, 787 entries |

Independent review identified and corrected four intermediate issues. An object
with a null source but a quotation or an affirmative answer is no longer counted
as abstention: only null source, empty evidence and the explicit frozen
`Insufficient evidence` answer qualify. Contradictory objects are invalid and
unscored for answer quality. Fixture creation now uses exclusive mode-0600
creation before writing, including when the destination parent already exists.
Integrity checks now use explicit exceptions, so Python optimization cannot
remove them. Whitespace-only passages cannot earn exact-quote or joint
source/quote credit; spaces and newlines have regression coverage. Generated Python cache bytes were moved to private evidence rather
than included in the public source scope.

The CLJC law separates valid completed output from timeout, incomplete streams,
malformed objects and contradictory timing. It scores labeled source selection,
exact contiguous quotation, anchor coverage and abstention separately. The joint
source/quote metric does not establish semantic correctness of the entire answer.
Anchor spans are reference evidence, not the only acceptable exact quotation.
Cold loading, first visible text and usable completion must remain distinct.

## Why inference was deferred

The resource observations at 21:49 UTC concern an **owned CPU worker design**.
They do not claim an existing isolated worker is running, nor predict safe GPU
placement. Even assuming the proposed owned, read-only worker existed, both
hosts fail its resource floor of model artifact bytes plus 2 GiB:

| Host | Available RAM | Required floor | Other model in shared Ollama | Prospective admission |
| --- | ---: | ---: | --- | --- |
| Stealth | 8.75 GiB | 10.95 GiB | none | denied |
| Yoga | 1.17 GiB | 10.95 GiB | another resident E4B profile | denied |

The pinned `gemma4:e4b` tag is present on both hosts, but no load, generation,
warmup, unload or production model request was issued. The shared Ollama
endpoints received only read-only metadata requests. The floor is a conservative
admission minimum for the proposed CPU design, not measured model RAM usage or
proof that an admitted run would complete. Future workers still need hard
resource bounds and cleanup verification.

The isolated inference worker/streaming adapter and tokenizer/context-retention
proof remain unimplemented. The fixed 4,096-token context is a proposal until
those checks establish that neither condition silently loses source text. The
CPU-only proposal is a fresh within-host comparison and cannot be compared
directly to the older pilot's backend timings. A GPU placement variant needs its
own versioned resource policy; this work does not silently grant GPU admission.

## Budget, preservation and remaining gates

At 21:47 UTC the official Colab usage check showed zero rate and assignments,
and the direct assignment list was empty. The original campaign state bytes
were unchanged. Conservative reservations remain **4 of the original 30 units**;
this stage made zero cloud allocations and zero model requests. Reservations
are not a claim of precise measured billing.

The frozen fixture and excerpts stay private under the campaign's
`ann-followup/e4b-quote-v2/` directory. Public source contains synthetic test data,
protocol and hashes, not the private excerpts. Host validation used exact
manifests, the Codex SSH login UID/loginuid 1002, and the existing host workspace
owner for file checks. No provider credential was transferred.

No SDK, compiled ANN adapter or tiered-ranking utility changed in this stage.
Their previous compiled artifact identities remain exact. This does not claim
new native MongoDB or model qualification. Whole-repository strict lint remains
held on the previously measured 7,783 warnings; no waiver, Done transition,
merge, deployment, restart or production adoption occurred.

Next: implement and test the bounded owned-worker/stream adapter and context
retention check without model calls first. Recheck admission before any actual
smoke. If the CPU design cannot fit Yoga, prepare a separate measured placement
proposal rather than weakening the existing guard or disturbing its workload.
Bounded lint cleanup may proceed independently while inference is deferred.
