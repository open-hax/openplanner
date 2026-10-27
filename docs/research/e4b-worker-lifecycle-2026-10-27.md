<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# Synthetic worker lifecycle — 2026-10-27

Status: bounded lifecycle qualification with fake child processes; no model
execution or production adoption. Base source is
`f0d5899cd6a69e31e3c5701936394fcd070baabb` on the isolated research branch.

The research adapter now reuses each host's existing systemd user manager for
transient synthetic jobs. It installs no production service or scheduler.
Policy stays in CLJC; the Python boundary can launch only the shipped fake
worker, with four named behavior modes. There is no model launch plan. The
separate test profile limits runtime to two seconds, RAM to 64 MiB, swap to
zero, tasks to eight and CPU quota to 25%, with a 200 ms stop grace and cgroup
SIGKILL fallback. Unit output is discarded rather than entering an unbounded
application log. These test limits do not weaken or admit the CPU model proposal.

Private intent leases are written at mode 0600 and synced before submission.
A durable attempted marker precedes submission, including failures without an
observed invocation. Unique temporary lease-write names leave interrupted writes
as private evidence without blocking recovery. A unique unit nonce/description
and manager invocation ID govern teardown;
names are never reused. Recovery from an owned private lease grants teardown
only. Unknown/stale identities fail closed. The manager owns hard expiry even
when the controller is absent. Stop checks unit disappearance and the empty or
absent previously observed cgroup, including a fixture child that changes its
process group. This avoids treating a PID/process-group name as durable ownership.

The contract is cooperative. Another same-UID manager client can alter units
or lease files, and systemctl offers no atomic compare-and-stop. This is not
security isolation from that client. A later inference controller still needs
read-only cache/mount proof, endpoint ownership, exact model/context identity,
resource admission and review. Exec success and the fake readiness marker do
not establish that a model endpoint is ready or owned.

## Evidence and limits

| Check | Result |
| --- | --- |
| Synthetic worker suite | 14 methods passed on each host |
| Existing fake HTTP suite | 18 methods passed on each host |
| CLJC law suite | 10 tests, 99 assertions on each host; zero failures/errors |
| clj-kondo | zero warnings/errors |
| Remaining fixture units | none on either host after checks |
| Full repository strict lint | zero errors, 7,783 warnings; gate held |
| TypeScript inventory | 558 active files, 787 entries; passing |


Both hosts verify exact staged source hashes, then run the CLJC law, synthetic
HTTP and synthetic worker suites through Codex SSH (UID/loginuid 1002) and the
existing workspace owner (UID 1000). The user manager is a separate daemon;
its process loginuid is recorded in private fixture observations and is not
claimed to inherit the SSH requester's identity. Final source review and final
host records are required before retaining a qualified checkpoint.

The lifecycle tests cover graceful/forced stop, a nonzero startup exit, manager
hard expiry with no controller stop/watchdog, cancellation with finally cleanup,
recovery by a fresh controller, stale invocation/foreign description denial,
an orphan child reaching manager expiry after its parent exits, and lost
submission response followed by reconciliation and cleanup. The latter
injects a supervisor timeout after actual submission; it is not a real transport
outage. The lifetime test deliberately omits controller action; it does not kill
an actual controller process. Tests retain evidence and leases and verify no
fixture units remain loaded. Synthetic passes are not model-quality, native
retrieval, actor, or production qualification.

Initial development checks exposed an unsupported `Path.open(opener=...)` call;
using builtin `open` preserves exclusive mode-0600 creation. An early-exit
fixture also showed that a failed unit can have no remaining ControlGroup.
That test now verifies the exit code, zero MainPID and unit disappearance,
without inventing an observed live cgroup. Independent review also found
nonce reuse after a failed submission with no observed invocation, and recovery
blocked by a leftover fixed temporary lease file. The durable attempted marker
and unique temporary writes address these cases, with injected negative tests.
Review also found that default main-process exit tracking could deactivate
the lifetime timer after an orphaning parent exits. Explicit `ExitType=cgroup`
and a child-only expiry regression cover that separate path. Earlier failed
evidence is retained. Readiness now requires the running substate; failed or
active/exited units cannot reuse a stale marker.

Read-only local discovery found an installed Ollama executable and Transformers,
but no `llama-tokenize`, `llama-cli`, `llama_cpp` or GGUF Python module in the
checked environment. Metadata-only `ollama show` found the exact existing model
blob reference and retained hashes of the exported model file/template output.
This did not tokenize the frozen requests, prove chat-template overhead, load a
model, or authorize a different tokenizer. The 4,096-token proposal remains
unqualified. No installation/download was performed during this stage.

The private eight-case fixture remains pinned at
`83ecc2b40e95ca273c47b13225462f04d1148ca1ee78fcf28992c9f1b59a0408`.
Prompts, retrieval parameters, model digest, quantization and output budget are
unchanged; no locked cases or model outputs were used. No SDK/compiled ANN or
ranking artifact changed and no native database test is newly claimed.
The whole-repository strict lint gate remains held; no waiver or adoption-ready
claim follows from these synthetic suites. A fresh measurement remains zero lint errors and 7,783 warnings; the
TypeScript inventory still passes with 558 active files and 787 entries.

No model inference, cloud allocation, service restart, deployment, merge,
routing change or production action occurred. The original campaign retains
four conservative reservation units of its same 30-unit cap; that reservation
is not a precise measured charge. At 01:45 UTC, official usage showed zero rate/assignments and the direct
assignment list was empty. Campaign state bytes were unchanged. Fresh telemetry
is still required before any later allocation.
Private commands, manifests, host outputs, review and budget evidence live in
`ann-followup/e4b-worker-v1/` and active artifacts remain protected.

Next: establish exact tokenizer plus chat-template retention using the existing
model metadata/cache, then design the admitted model launch and owned-endpoint
binding. Do not turn this synthetic plan into model authority or poll denied
resources without another concrete prerequisite completed. Bounded lint repair
can proceed independently while production remains held.
