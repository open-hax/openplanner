<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Frozen E4B quote-fidelity experiment v2.1

This research candidate freezes a prompt comparison, private source excerpts and
portable scoring/admission laws. It has not run model inference and is not a
production capability. The bounded HTTP stream transport has passed synthetic endpoint tests; the
synthetic lifecycle controller now exercises the existing user manager. An admitted model launch path and transport-integrated endpoint binding remain unimplemented. A separate bounded Linux endpoint preflight is tested with an owned listening child and synthetic manager facts; it grants no model readiness. Offline token retention is tested for a separately pinned research backend; live runtime confirmation remains pending. See `protocol.edn` for the explicit remaining execution gaps.

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
fixed request parameters and response scoring. Python handles frozen files, SHA-256 checks, the BB process boundary and bounded
HTTP/NDJSON I/O. The CLI takes one JSON operation on
stdin and returns one JSON result. The fixture/validation commands and synthetic stream tests do not contact Google,
MongoDB or a model server, allocate compute, write model weights, or modify production.

```sh
bb docs/research/e4b-quote-v2/law_test.clj
clj-kondo --lint docs/research/e4b-quote-v2
python3 -B docs/research/e4b-quote-v2/stream_test.py
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


## Bounded stream transport

`stream_adapter.py` is an I/O primitive, not an inference command or worker
ownership proof. There is no live CLI. Tests create their own ephemeral fake
HTTP servers; the adapter permits numeric IPv4 loopback `/api/chat` only and
always rejects the shared port 11434, credentials in URLs, redirects and remote
targets. A future controller must prove the endpoint belongs to its bounded
worker, verify model/context identity and obtain fresh admission before use.
A loopback address alone does not establish ownership.

Bounds come from the CLJC `transport-bounds` data, exposed through the BB CLI's
`transport-bounds` operation. The adapter uses nonblocking connection setup and
an absolute deadline/cancellation watchdog that shuts down its own socket during
stalled headers, stalled bodies or continuously arriving fragments. Final JSON
parsing is included in usable-output timing. It records facts and sends no
answer-quality judgement; the existing CLJC scorer handles that separately.

The normal profile allows 20 seconds, 64 KiB request/decoded response bodies,
16 KiB lines and retained visible text, 1,024 events, and JSON nesting depth 32.
A framing read may consume one extra byte to detect a limit violation; retained
visible text never exceeds its cap. The response-body cap is not an HTTP-header
or total network traffic quota; Python's HTTP header limits and the absolute
socket deadline also apply. Duplicate keys, nonfinite numbers (including float
overflow), invalid UTF-8 and malformed framing are rejected. Non-object or
malformed final answer JSON remains unqualified by the scorer.

Synthetic tests lower deadlines without changing the frozen model profile.
They verify socket closure and watchdog termination after completion, timeout
and cancellation, and exercise chunked transfer, UTF-8 boundaries, size/depth
caps and cleanup errors. First visible time means the first nonempty received
content fragment, matching the earlier probe's definition. Raw provider timing
fields are retained as provider claims, not independently verified timings.
These tests are not model, context-retention, native retrieval or production
qualification, and do not authorize cloud allocation.

## Synthetic worker lifecycle

`worker_adapter.py` submits only `fake_worker.py` through the existing systemd
user manager. It has no arbitrary executable or model launch option, production
service installation, scheduler, download or inference CLI. The CLJC
`worker-test-plan` operation supplies a separate two-second test profile:
64 MiB RAM, zero swap, eight tasks, 25% CPU quota, no restart, 200 ms stop grace,
cgroup exit tracking, control-group kill and forced teardown. These are synthetic bounds, not a change
to the frozen model proposal. Unit output is discarded; observations remain in
an explicitly supplied private evidence directory.

A random unit name/description and mode-0600 intent lease precede submission.
The controller reconciles the manager's invocation ID before teardown. Fresh
controllers can recover private owned leases for teardown only. Unit names are
never reused. Unknown descriptions/invocations fail closed. Manager expiry
survives an absent controller. A successful stop requires unit disappearance
and an empty or absent previously observed cgroup; tests include a child in
a different process group. No PID-based kill or group-name guess is used.

This is a cooperative ownership contract: another same-UID manager client can
alter units or files, and systemctl has no atomic compare-and-stop. The nonce
and invocation checks do not provide a security boundary against that actor.
The user manager's child loginuid can differ from the requesting SSH session;
retain both requester identity and unit/invocation evidence, and do not claim
the daemon inherited caller attribution. Exec success is not endpoint readiness.
The fixture readiness file proves only this synthetic process reached its marker.

To reproduce, set `XDG_RUNTIME_DIR` and the existing user bus appropriately,
then use a new private path whose parent exists:

```sh
E4B_WORKER_EVIDENCE=PRIVATE_NEW_DIRECTORY python3 -B docs/research/e4b-quote-v2/worker_test.py
```

The suite retains its evidence and leases; it does not delete them automatically.
It starts only small synthetic processes and stops only its own nonce-bound units.
It requires the existing Linux cgroup v2/user manager, and fails on unavailable
capabilities. A failure is not permission to fall back to shared production
workers. Model cache mounts, exact tokenizer/chat-template context retention,
owned endpoint binding and fresh resource admission remain separate gates.

## Exact offline tokenizer and native rendering

`token_probe/render.go` imports the unmodified renderer from Ollama 0.32.5
(source `eec8e0b9458b8a01be0c216a9cc53eefde24ef50`) and emits the complete
`gemma4-small` prompt, including native turn markers and the generation prefix.
Build it within that pinned upstream module; no production binary is rebuilt or
replaced. `token_probe/vocab.c` links to a byte-pinned copy of Stealth's existing
native library using the upstream b10091 headers. Native ABI qualification is
limited to artifact identity and observed behavior; source reproducibility of
the installed native library is not established. It sets vocabulary-only mode,
disables mmap and GPU offload, and never creates an inference context or reads
tensor weights. The matching native compatibility layer is retained.

The metadata process has a 512 MiB address-space cap, 15 CPU seconds, 16 framed
inputs and 64 KiB per input. Its caller enforces 20 seconds wall time. The
separate offline profile requires at least 768 MiB available memory; it grants
no model execution and does not replace the model-bytes-plus-2-GiB CPU guard.
The Go renderer has bounded input lines/count and is supervised with a wall
timeout; its runtime memory setting is a soft target, not a hard cgroup limit.

Requests use compact UTF-8 JSON containing `question` and `sources`; each
source has `id` and `text`, in frozen order. Both conditions use identical
source-bearing payloads. Metadata-only validation neither changes excerpts nor
uses locked cases or answer output. The native helper compares the full rendered
encoding without automatic specials against the completion path that strips
rendered BOS and inserts native special tokens. All token IDs must match.
Detokenization with special markers must reproduce the full rendered bytes.
The CLJC retention law additionally reserves 256 output tokens and one native
slot within 4,096, and grants no model or production authority.

Cross-host offline validation uses the same research renderer and native bytes.
Earlier Ollama CLI version calls reported 0.21.2 on Yoga and 0.32.5 on Stealth.
Those are server metadata observations with unrecorded inherited endpoints,
not verified local ELF build identities. Final offline validation makes no
server calls. Passing the copied bundle does not qualify a production backend. The existing
model manifest, config and full GGUF blob are verified on each host. A future
owned inference worker must bind this profile or obtain a separate qualification,
and confirm actual runtime prompt accounting before scoring model output.

Reproduction requires the seven upstream b10091 headers and the three recorded
shared libraries in a task-owned `runtime/` directory. Compile C with
`-Wall -Wextra -Werror`, the recorded headers, and a runtime-relative library path.
Build Go using the pinned Ollama module and `-mod=readonly`; retain build info,
source/binary/library hashes and process attribution. Private harness commands
and byte manifests are retained in `ann-followup/e4b-token-retention-v1/`.
Never stage fixture text, rendered prompts, Go caches or the runtime bundle.


`endpoint_probe.py` reads only a named process's bounded Linux metadata, descriptor
links and IPv4 listener table. `observe_worker` joins those facts to two reconciled
snapshots of the existing controller, refusing an unpinned invocation first.
`research.e4b-endpoint-law` validates synthetic lifecycle evidence through the
`endpoint-bounds` and `endpoint-evidence` law CLI operations. A matching snapshot
is not atomic connection ownership, exclusive socket ownership or a boundary
against another process with the same UID. No request path uses this preflight
as model authorization. See the dated endpoint-preflight report for remaining
controller, cache, backend, live-token and resource-admission gates.
