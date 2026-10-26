<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Frozen E4B quote-fidelity experiment v2.1

This research candidate freezes a prompt comparison, private source excerpts and
portable scoring/admission laws. It has not run model inference and is not a
production capability. The model transport and isolated worker launcher remain
unimplemented. See `protocol.edn` for the explicit remaining execution gaps.

The experiment asks whether one fixed extraction-first system instruction
improves source-bound exact quotation. Both prompts receive identical question,
source order and text, model digest, quantization, sampling settings, context
and output budgets. This version proposes an owned CPU worker, not a shared
production Ollama endpoint. It is a fresh controlled comparison within each
host; its timing cannot be compared directly to the earlier pilot's backend.
A GPU variant would need a separate version and admission policy.

Eight frozen text cases use four development and four validation cases from
the original 24-case corpus. Locked cases, image cases and filename-only audio
cases are excluded. The already-selected raw/512/fusion-0.5 retrieval is fixed;
there is no new optimizer or parameter sweep. Source excerpts are the first
1,500 characters of each of the five selected source chunks. Five cases include
the labeled source anchor in the supplied excerpts; three do not. Report that
retrieval-context limitation separately. It is not a new answer-quality label.

Prompt order is counterbalanced within each split, fixed before model output.
The smoke IDs are one lyrics and one lore development case, using opposite
condition order. A smoke is an execution check, not a two-case quality claim.
No prompt is adapted from validation or locked output.

`src/research/e4b_quote_law.cljc` owns fixture admission, resource admission,
fixed request parameters and response scoring. Python only handles frozen files,
SHA-256 checks and the BB process boundary. The CLI takes one JSON operation on
stdin and returns one JSON result. No adapter here calls Google, MongoDB or a
model server, allocates compute, writes model weights, or modifies production.

```sh
bb docs/research/e4b-quote-v2/law_test.clj
clj-kondo --lint docs/research/e4b-quote-v2
python3 docs/research/e4b-quote-v2/validate_fixture.py PRIVATE_FIXTURE \
  --expected-sha256 83ecc2b40e95ca273c47b13225462f04d1148ca1ee78fcf28992c9f1b59a0408
```

`freeze_fixture.py PRIVATE_CAMPAIGN_ROOT PRIVATE_OUTPUT` verifies the original
case and corpus identities, reads the completed candidate's fixed configuration
and source lists, and writes a new private fixture with mode 0600. It refuses to
overwrite an existing fixture. The fixture contains private excerpts and must
never be staged with this public source. Its hash is pinned in `protocol.edn`.
The validator rechecks the entire fixture and each excerpt before presenting
verified facts to the pure admission law.

The exact quote metric requires at least eight characters copied contiguously
from the selected source. Source identity, exact quotation, frozen anchor
coverage and abstention are separate metrics. The joint metric requires the
labeled source and an exact quote; it does not establish semantic correctness
of the whole answer. Frozen anchors are reference spans, not the only acceptable
quotation. A completed object after 20 seconds, a malformed object, an unfinished
stream or contradictory timing is not scored as an answer-quality result.
Cold load, first text and completion must be retained separately. Do not treat
missing first text or incomplete Yoga output as a wrong completed answer.

Before inference, the future worker adapter must prove ownership/cleanup,
read-only use of the existing model cache, exact model identity and sufficient
memory/load headroom. It must verify token retention rather than silently
truncating either prompt's source context. The fixed 4,096-token setting is a
proposal until that check passes. The current resource guard is deliberately
for the owned CPU design; it is not a claim about safe GPU placement.

This stage spends no Colab units. The same campaign retains its original
30-unit cap and four conservative reservations. This protocol grants no cloud
admission; any future cloud job needs the existing budget law, fresh telemetry,
explicit owned-runtime bounds and verified cleanup. No GPU admission exists in
the current cloud pilot. Production remains held pending the broader gates and
explicit human adoption authority.
