# Bounded endpoint preflight for the isolated E4B experiment

The research candidate now has a read-only Linux endpoint observation adapter
and a separate portable evidence law. This closes part of the observation seam
between the previously tested worker controller and HTTP transport. It does
not admit a model, prove a model endpoint ready or authorize a connection.
No model execution, cloud allocation or production action occurred.

## Source, scope and evidence

The parent is `ac450fe4e16c03f3e414e078cd78decd6101a33f` on the isolated
`codex/ann-empty-recovery-20261026` branch. Existing lifecycle leases, controller
reconciliation, transport, frozen prompts and quote/retrieval cases are retained.
No replacement service, supervisor or scheduler was introduced.

`endpoint_probe.py` reads a specified process's PID/start ticks, four UID values,
unified cgroup, network namespace, bounded descriptor links and IPv4 TCP table.
It checks process identity and descriptor-name/target snapshots before and after
capture. Files are capped at 1 MiB and descriptor enumeration at 256. Missing,
malformed, changed or oversized observations fail closed. Fixture roots remain
marked as fixtures. It makes no outbound connection and does not inspect all
processes or shared inference endpoints.

`observe_worker` reuses an already pinned existing controller. It reconciles
before and after process capture, recording the queried unit and lease identity.
An unpinned invocation is rejected before reconciliation, avoiding its optional
lease-persistence path. The adapter never invokes start, stop, model load or
unload. This join is tested with mocked controller facts; a real managed listener
join is still a separate gate.

The CLJC law checks the qualified synthetic lifecycle unit naming/description,
nonce and invocation, stable running manager snapshots, PID, nonroot UID and its
user-manager cgroup, matching network namespaces, numeric loopback address,
allowed port, a single matching IPv4 listener row and a process-owned socket
inode. It rejects the shared port 11434. Its result always retains explicit
`model-execution`, `production-adoption` and `cloud-allocation` denials.
The pure law consumes observations; a caller-supplied map is not trusted operating
system evidence or an authorization token.

The new tests include an actual owned, short-lived listening Python child.
It binds an ephemeral loopback port, exposes its PID/port, and is observed through
real `/proc`. The test reaps it and verifies its PID path is absent. That child
is not a managed model worker; its process evidence supplies no manager ownership
or model-readiness claim. Fixture tests cover stale process identity, descriptor
changes, wildcard addresses, missing owned FDs, duplicate/malformed metadata,
input bounds, an unpinned controller and differing manager snapshots.

## Checks and precise limits

| Check | Result |
| --- | --- |
| New Python observer/controller-join suite | 12 methods pass locally and in the attributed Stealth worker |
| New CLJC endpoint law | 4 tests / 58 assertions pass locally and on Stealth |
| Existing quote/admission/token laws | 11 tests / 130 assertions pass |
| Existing HTTP transport suite | 18 synthetic methods pass |
| clj-kondo for changed Clojure files | zero errors/warnings |
| Full repository strict lint | zero errors / 7,532 warnings; held, unchanged |
| TypeScript inventory | 558 active / 787 entries; passes, unchanged |
| Yoga | direct harness SSH returned No route to host; unqualified |

The manifest-bound Stealth validation uses Codex SSH UID/loginuid 1002 and
execution as err/1000, with a 30-second timeout per test command. It starts no
systemd units or containers and contacts no model server. Its listening child
has its own three-second exit bound plus explicit parent teardown. This is
process/test attribution, not an attestation of a production actor or backend.

Matching FD snapshots do not prove the TCP table stayed constant throughout
capture. A socket FD can also be shared with another process. A valid preflight
is neither exclusive ownership nor an atomic compare-and-connect operation;
another same-UID actor remains outside this cooperative boundary. The existing
HTTP adapter has not been wired to this result. A real managed fake listener,
controller identity at request time and the future model profile still require
integration tests before research inference.

A separate read-only observation fingerprints the installed Stealth Ollama ELF:
39,107,216 bytes, SHA-256
`83b45dfdaa750e7ca00fc4ecb90c6bca4e1cdb3ce177e6622cec49cb68fa6c3e`.
`go version -m` reads embedded build metadata and reports Go 1.26.0 with a devel
module. It does not establish the installed Ollama release or source commit.
The target executable was not run. This does not replace the separately pinned
offline renderer/native vocabulary profile, qualify tensor inference or correct
the historical server-version observations into executable-version evidence.

## Lint, budget and preservation

A fresh SDK warning-ownership snapshot is retained in the private phase. MongoDB
is the largest SDK target, with 462 readonly-type warnings among its 476 warnings.
Many are exported mutable interfaces. Converting an interface to an alias can
remove declaration-merging support; an empty derived interface introduces
another warning under the current rules. No mass annotation, public interface
rewrite, lint waiver or SDK runtime change was made in this endpoint tranche.
A future bounded SDK tranche must capture that public contract or extract an
actual pure policy, rather than assume assignability proves full compatibility.

The original campaign remains capped at 30 total Colab units with four
conservative reservations, not four measured billing units. This stage's
read-only usage record reports balance 399.54, zero rate/assignments and an empty
direct assignment list; campaign state bytes are unchanged. Refresh telemetry,
remaining allowance, ownership, limits and cleanup before any allocation. This
stage grants no cloud/GPU admission and does not weaken the CPU model-bytes-plus-
2-GiB guard or permit shared-server inference or workload interruption.

Commands, source manifests, failures, exact host evidence, independent review,
ELF metadata, warning ownership and budget records are retained under
`ann-followup/e4b-endpoint-proof-v1/`. Its evidence and all previous protected
stages remain local pending verified Yoga recovery; no scratch was reclaimed.
The public source remains separate from production. The previous SDK
`stage-final` and embedding-model `stage-v3` still need exact Yoga qualification.

Next: connect this preflight to an owned synthetic listener under the existing
controller, verify the real manager/process/socket join and request-time
reconciliation, then finish the reviewed cache/backend/live-token/admission
requirements before considering the frozen two-case model smoke. Continue a
bounded SDK lint tranche independently; global lint, Yoga, model/modality/actor
qualification and explicit human adoption remain open.
