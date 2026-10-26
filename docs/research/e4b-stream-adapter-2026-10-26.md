<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Bounded E4B stream adapter — 2026-10-26

Status: transport tested against owned synthetic HTTP endpoints on Stealth and
Yoga; no model inference. This isolated continuation follows
`cf4b67d19ac3c12ff6f4f9f0d4c234a6c614ccae`. Production remains held.

## Implemented boundary

The new Python `stream_adapter.py` handles bounded HTTP/NDJSON I/O. It has no
live inference CLI and creates no model worker. Request and scoring policy stay
in the existing CLJC law; transport bounds are versioned data exposed by its BB
CLI. The frozen eight-case fixture, prompts, selected retrieval configuration,
model digest and sampling/output parameters are unchanged.

The adapter permits numeric IPv4 loopback `/api/chat` only, always rejects the
shared port 11434, and rejects credentials, query strings, remote hosts and other
schemes/paths. It does not follow redirects. These target limits do not prove
endpoint ownership. A future controller must establish its own bounded worker,
verify model identity/context retention and obtain fresh resource admission.

Connection setup is nonblocking and cancellable. An absolute deadline watchdog
shuts down the adapter's own socket during stalled headers, stalled bodies or a
continuous trickle. Usable-output timing includes final JSON parsing. The shared
finalization lock prevents a stale watchdog from acting after descriptor close
or reuse; remaining closers are attempted even if one cleanup operation fails.

The normal profile is 20 seconds; request and decoded response body caps are
64 KiB; line and retained visible-output caps are 16 KiB; event count is capped
at 1,024 and JSON nesting at 32. A framing read may consume one additional byte
to detect excess, while retained visible output stays within its exact bound.
The body cap is not a total wire/header quota: Python's header limits and the
absolute socket deadline apply separately. Duplicate keys, nonfinite literals
and float overflow, invalid UTF-8 and malformed frames are rejected.

The returned record contains transport facts, partial output, client timings,
completion/cleanup status and raw provider timing claims. It does not judge
answer quality. The existing CLJC scorer rejects incomplete or invalid output
from quality scoring. Completion of a syntactically malformed answer can be
recorded separately from a usable, schema-valid answer.

## Verification

| Check | Result |
| --- | --- |
| Python transport integration suite | 18 test methods passed |
| Portable CLJC suite | 9 tests, 74 assertions; zero failures/errors |
| clj-kondo | zero errors/warnings |
| Stealth and Yoga | exact executable manifests; each passed both suites |
| Python adapter syntax | passed without writing public bytecode |
| TypeScript inventory | unchanged, passing: 558 active files, 787 entries |
| Private model fixture | original hash unchanged; no new cases or model output |

Every HTTP test owns its ephemeral fake server. Coverage includes fragmented
JSON, chunked transfer and UTF-8 boundaries; quiet headers/body and continual
trickle; cancellation before connection and during a request; body/line/event/
visible/depth caps; malformed and nonfinite JSON; redirect rejection; parse
lateness; cleanup errors; and complete/incomplete facts passed through the real
CLJC scorer. Tests verify socket/watchdog and fake-server termination. Their
short test deadlines are not changes to the frozen 20-second model profile.

Independent review identified three intermediate problems and verified the fixes:
float overflow such as `1e400` now receives finite-number validation, retained
partial output cannot exceed the visible byte cap, and `/api/chat` is enforced
independently of caller-supplied bounds. New negative cases cover each. An early
deep-JSON test also demonstrated that parser recursion assumptions are not a
portable structural bound; explicit nesting limits now enforce that boundary.

Cross-host validation used Codex SSH UID/loginuid 1002 and the existing workspace
owner for test execution. Both hosts ran only synthetic endpoints, not their
shared Ollama service. The final validation binds the reviewed source hashes;
preliminary host records are retained separately when source changed during
review. No provider credential or private source excerpt was transferred for
these transport checks.

## Limits and next step

There is still no isolated model-worker/controller, no tokenizer/context-retention
proof, and no real smoke result. The earlier resource denial concerned the CPU
proposal at that observation time; it was not reclassified as an answer-quality
failure or permission to disturb another workload. This stage did not poll those
workloads merely to fill time. Before any actual inference, the controller must
prove ownership, hard resource/lifetime bounds, teardown, exact model identity,
context retention and fresh admission. GPU placement remains a separate versioned
proposal; no cloud/GPU admission is granted here.

No SDK or compiled retrieval artifact changed. No new native MongoDB result is
claimed. The broader strict lint holdback remains 7,783 warnings, with no waiver
or production-readiness claim. No merge, deployment, service restart, model load,
generation, unload, model-weight change or routing change occurred.

At 23:49 UTC, official Colab usage reported zero rate and assignments, and the
direct assignment list was empty. The original campaign state bytes were
unchanged: **4 conservative reservation units of the same 30-unit cap**, with
zero new cloud allocations. The reservation is not precise measured billing.

Source and reproduction commands are in
[e4b-quote-v2/README.md](e4b-quote-v2/README.md). Private logs, manifests, review,
qualification and recovery evidence are under the campaign's
`ann-followup/e4b-quote-stream-v1/` directory. Active inputs remain preserved.

Next: implement the owned-worker lifecycle/controller and its failure/cleanup
tests without model loading, then establish token retention before considering
an admitted two-case smoke. Bounded lint work can proceed independently.
