# E4B owned-backend source audit — 2026-10-28

Status: design evidence only; no model or cloud execution is admitted.

The source inspected is the existing clean Ollama reference at commit
`eec8e0b9458b8a01be0c216a9cc53eefde24ef50`, previously used to build the
offline research renderer. It is not evidence that either installed Ollama
server was built from this commit. The candidate worktree started clean at
`8111d06d78319a422c89c5a478597d856450cecd`.

## Findings for the proposed owned worker

* `cmd/cmd.go:RunServer` initializes a keypair under `$HOME/.ollama` before
  opening the listener. The worker therefore needs a private, task-owned home;
  merely redirecting the model directory does not isolate this state.
* `manifest.BlobsPath` attempts to create the blob directory, and
  `server/routes.go:Serve` calls `fixBlobs` before its optional pruning block;
  `server/fixblobs.go` walks the blob tree and renames colon-form SHA-256 names.
  Without `OLLAMA_NOPRUNE`, startup attempts to prune layers and manifest
  directories if manifest enumeration succeeds; corrupt manifests skip pruning.
  Setting that option alone is insufficient to prove read-only behavior: the
  unconditional `fixBlobs` path and other startup writes must be tested with a
  kernel-enforced read-only model view and an isolated writable home. Failure to
  start under that view is a denied admission, not permission to make the source
  model cache writable.
* `envconfig/config.go` defaults the host to `127.0.0.1:11434` and resolves
  `OLLAMA_MODELS` separately from home. The launch profile must explicitly bind
  a private numeric-loopback port distinct from the shared service and give the
  worker an explicitly identified model view. Environment variables describe
  intent; they do not by themselves establish socket ownership or mount mode.
* In this source, native chat truncation defaults on when `truncate` is omitted,
  and native chat shifting defaults on when `shift` is omitted. Non-native MLX
  chat explicitly disables truncation. A prospective fixed
  request must explicitly set both false and fix the context/output options.
  These flags do not prove that the selected backend accepts the complete input.
  Compare the live backend's reported prompt count with the pinned offline frame
  and treat missing/mismatched accounting, overflow, or incomplete output as
  unscored infrastructure outcomes.
* The chat handler schedules a runner before the `_debug_render_only` branch.
  Consequently that flag is not a model-load-free preflight. Do not invoke it
  to bypass the existing model launch and resource admission gates.

## Proposed next qualification

First review and test a separate owned launch profile with synthetic, small
model-directory fixtures: private home, a read-only model mount, denied network
egress, explicit no-prune/no-cloud settings, a non-shared loopback port and an
owned transient worker with bounded memory, process count and lifetime. Verify
startup writes, actual mount flags, process and socket identity, failure cleanup,
and refusal on changed manifests or uncontrolled paths. Preserve the existing
synthetic listener's limitations: snapshots do not prove atomic connection or
exclusive ownership. Do not start the real server until the backend executable
and libraries are independently qualified, the exact model cache and ownership
are pinned, and fresh resource admission passes the model-bytes-plus-2-GiB CPU
guard. A different placement needs a separately versioned policy.

Then, only under that admitted backend, compare live prompt accounting with the
previously frozen eight-case offline token frames before scoring the existing
two-case smoke. The prior 1,481–3,047 token result is offline vocabulary evidence,
not live runtime retention, answer quality, or a production backend identity.
The previous CLI version strings came from server metadata at unrecorded endpoints.

## Evidence and bounds

Read-only commands: `git rev-parse HEAD` in the reference; targeted `rg` and
`sed` of `cmd/cmd.go`, `envconfig/config.go`, `server/routes.go`,
`server/fixblobs.go`, `manifest/paths.go`, and
`api/types.go`; `sha256sum campaign-state.json`; `df -h /home/err`; and a
four-second direct `yoga-agent-codex` SSH probe with agent forwarding disabled.
Yoga returned `No route to host`; its six existing exact artifact qualifications
remain pending. Disk availability was 151 GiB at inspection; no large allocation
was made. No endpoint was contacted, no server/worker started, no model loaded,
no inference performed and no Colab runtime allocated. There was no process or
runtime cleanup to perform. The campaign state hash remains
`10d55910a61ea31e205c9b1714268b616a9b6a1f6311883c44f67993e5d5944c` with four
conservative reservations against the original 30-unit cap; reservations are
not measured charges. Last recorded account telemetry at 18:24 UTC showed zero
rate and assignments; it is not fresh allocation admission.

A later local `free -b` observation reported 10,593,112,064 bytes available on
Stealth, below the proposed 9,608,350,718 model bytes plus 2 GiB requirement
(11,755,834,366 bytes). This instantaneous check denies that CPU placement now;
it is not a resource reservation and does not establish Yoga's resources.

Global lint remains held at the last measured 7,484 warnings, with zero errors;
the inventory passed in the previous tranche. Neither was rerun by this audit.
No source implementation, model behavior, ANN behavior, production routing or
deployment changed. Before cloud allocation refresh direct assignments, balance,
budget law, limits, ownership and cleanup. Preserve all prior evidence and the
original frozen cases; production adoption remains subject to explicit approval.
