# Real managed synthetic listener and fixed transport join

The isolated E4B research candidate now joins a real transient user-manager
fixture, its Linux process/socket observations and one fixed HTTP/NDJSON request
on Stealth. This supplies the previously missing managed-listener integration
evidence. It remains a synthetic path: no model has been loaded or queried, and
it grants no model, cloud or production authority.

## Source and bounded behavior

The parent is `3062e47aa7869ee25ad43b23998aea10345a7a26` on
`codex/ann-empty-recovery-20261026`. The existing `Worker` controller, durable
nonce/invocation leases, user manager, endpoint observer and bounded transport
are reused. There is no replacement supervisor or production service.

A new `listener` fixture mode has its own `e4b-managed-listener-v1` schema and
law-supplied marker. It keeps the existing two-second hard runtime, 64-MiB memory
limit, zero swap, eight tasks, 25% CPU, control-group teardown and no restart.
The previous four mode plans retain their values. The listener binds only an
unused numeric loopback port and records readiness after binding. Its HTTP
handler accepts a small JSON object containing only the expected fixture marker,
records at most one successful request and returns a constant bounded NDJSON
response. It never evaluates supplied code, imports a model runtime or reads
the frozen corpus.

`managed_fixture.consume_fixture(worker, port)` offers no configurable body,
host, model or arbitrary URL. It captures two complete observations through the
already pinned controller, including four manager snapshots and process/socket
identity. The CLJC law requires each observation to satisfy the synthetic
ownership contract and the two observations to agree. Only then does the wrapper
send the law's fixed marker through the existing transport. All decisions still
carry explicit model, cloud, production, atomic-connection and exclusive-socket
denials. A fixture request decision is not a model authorization token.

## Observed checks

| Check | Stealth result |
| --- | --- |
| New real managed-listener suite | 6 methods pass |
| Endpoint/request laws | 5 tests / 70 assertions pass |
| Existing lifecycle suite | 14 methods pass |
| Existing process/socket observer suite | 12 methods pass |
| Existing bounded HTTP suite | 18 methods pass |
| Existing quote/admission/token laws | 11 tests / 130 assertions pass |
| Changed Clojure/EDN clj-kondo | zero errors/warnings |
| Whole repository strict lint | exit 1, zero errors / 7,504 warnings; held |
| TypeScript inventory | 558 active / 787 entries; passes, unchanged |
| Yoga | direct harness alias returned No route to host; unqualified |

The six integration methods verify the following using real owned fixture units:

- A running manager invocation and MainPID match the observed process, cgroup,
  UID, network namespace, listening port and process-owned socket inode. Two
  observations agree, the fixed request completes through the actual transport,
  and its private receipt identifies that same PID.
- Stopping the real unit after the first observation makes the second observation
  fail before transport is invoked. No request receipt exists.
- A different listening port owned by the test caller has no descriptor in the
  managed worker and is refused before transport.
- A stale invocation is refused before transport; restoring the original lease
  permits normal owned cleanup.
- An arbitrary nonfixture body receives HTTP 400 and creates no success receipt.
- The manager expires the listening process at its hard lifetime without a
  controller stop call. The PID disappears; final teardown removes unit state.

These are fixture completion and ownership observations, not E4B latency,
quotation fidelity, provider token counts or answer-quality results. The fixed
response contains only the fixture marker and no source/evidence/answer payload.

## Identity, manifests and cleanup

The exact first artifact is `ann-followup/e4b-managed-listener-v1/stage-v1`.
Its 14 runtime/test files are hash-checked before execution. The host runner
requires execution UID 1000 and requester loginuid 1002, explicitly selects the
existing err user-manager bus and runs each test command with a 45-second caller
limit. Each fixture independently retains its two-second manager bound.

The readiness marker reports manager-child loginuid **1000**. This is separate
from the Codex SSH requester's **1002** and must not be described as inherited
requester attribution or independently verified central audit delivery.

All 19 owned lease records were reconciled and their unit identities were absent
after cleanup. This count includes legacy fixtures whose submissions were
rejected or never attempted; it is not a count of 19 started workers. The host
runner recovers only leases under its new, private phase evidence roots and
records cleanup in a finally block. Existing evidence roots are never reused.
No container or production service was started, stopped or restarted in this
stage. New transient test units were started and removed through the existing
manager, within their fixture ownership scope.

## Limits and remaining work

Two matching preflight observations do not create an atomic compare-and-connect
operation. A process or socket can change after the last check, and a descriptor
can be shared with another process. The same-UID cooperative boundary remains;
these observations prove neither exclusive socket ownership nor adversarial
isolation. The generic transport remains separate from model admission. No
claim is made that a real model endpoint, cache, backend or live prompt accounting
is qualified by this synthetic listener.

The SDK and its five ANN adapter artifacts were unchanged. Their combined
compiled identity remains
`2e8cc585b0fcc5a52242d64d804a23bd463ab9b0381bede28a9367146ed48b44`.
No native MongoDB run was repeated; captured empty-result replay, observed native
failures and the unproven historical engine cause retain separate evidence tiers.
The 7,504-warning global lint gate and all pending Yoga qualifications remain
open, with no waiver, Done transition or adoption-ready claim.

No Colab allocation, model load/download or inference occurred. The original
30-total-unit campaign still carries four conservative reservations, not measured
charges. A fresh usage/assignment record and unchanged campaign-state identity
are retained in the private phase. Refresh usage, remaining allowance, ownership,
limits and cleanup before any allocation. The model-bytes-plus-2-GiB CPU guard,
shared-inference prohibition and production holdback remain unchanged.

Commands, exact manifests, source review, private readiness/request observations,
lease cleanup, budget and remaining gates live under
`ann-followup/e4b-managed-listener-v1/`. All current and previous artifacts remain
protected pending verified remote recovery; no scratch was reclaimed. The
primary checkout and other projects' dirt were excluded.

Next: resume a bounded remaining indexing/SDK pure-policy tranche and prepare
the separately reviewed owned model cache/backend/launch profile and live-token
accounting path. Reuse this fixture integration as test evidence, preserving its
scope. Actual research inference still requires fresh resource admission and
model/context checks before the frozen two-case smoke; a different placement
needs its own versioned policy. No merge, production deployment/restart, model
routing or activation is authorized, and this stage grants no cloud/GPU admission.
