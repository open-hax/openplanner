<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
# E4B offline context retention — 2026-10-27

Status: an isolated offline research profile; no model inference, production
adoption or cloud allocation. Base source is
`61f193750976cc3b4bd66fb007e49cad7c4e8288`.

The earlier `{{ .Prompt }}` export was insufficient to count native formatting.
This tranche imports the unmodified Gemma 4 small renderer from the explicitly pinned
upstream tag Ollama 0.32.5, commit
`eec8e0b9458b8a01be0c216a9cc53eefde24ef50`. The model config declares `gemma4`,
which the pinned source resolves to its small renderer for E4B. The renderer
includes BOS, system/user turn syntax and the model generation prefix. The
exported generic Go template does not define that renderer path. See the
[pinned renderer](https://github.com/ollama/ollama/blob/v0.32.5/model/renderers/gemma4.go)
and [renderer selection](https://github.com/ollama/ollama/blob/v0.32.5/server/renderer_resolution.go).

The native helper uses copies of the existing Stealth `libllama`, `libggml` and
`libggml-base` with matching b10091 headers. Vocabulary-only loading explicitly
skips tensors; mmap and GPU offload are disabled, and no inference context is
created. The existing library includes Ollama's metadata compatibility layer. Its ABI
qualification is limited to exact artifact identity and observed vocab-only
behavior; a source-reproducible installed native build is not established.
This avoids substituting an unrelated Hugging Face tokenizer or generic
SentencePiece implementation. The [pinned runner's BOS handling](https://github.com/ollama/ollama/blob/v0.32.5/llm/llama_server.go)
strips rendered BOS before native special insertion. The helper verifies that
this completion path yields exactly the same IDs as encoding the complete
rendered prompt without automatic specials. Full detokenization must reproduce
the entire rendered byte sequence, including source-bearing payload and markers.

The newly recorded offline profile has explicit bounds: at most 16 frames,
64 KiB each, 512 MiB native address space, 15 CPU seconds and a supervised
20-second wall limit. Available memory must be at least 768 MiB. This is a
metadata-only profile; it does not weaken the 10.95-GiB owned CPU model guard,
permit another resident model, or authorize inference. The Go renderer's input
and lifetime are bounded; its Go memory setting is a soft target. No production
service, scheduler or model worker was installed or restarted.

## Measurements and interpretation

| Check | Stealth and Yoga result |
| --- | --- |
| Frozen prompt matrix | all 16 frames passed |
| Complete rendered token range | 1,481–3,047 on both hosts |
| Full roundtrip / BOS ID equivalence | 16/16 for each property |
| Native/renderer negative checks | 10 passed on each host |
| Portable law suite | 11 tests, 130 assertions; zero failures/errors |
| Existing fake HTTP suite | 18 methods passed on each host |
| clj-kondo | zero warnings/errors |


Sixteen requests cover both fixed conditions for all eight frozen text cases:
four development, four validation, zero locked. Compact UTF-8 JSON supplies
`question` and `sources`, with source `id`/`text` in frozen order. This encoding
was selected in the first probe before token results and is now explicit in the
protocol. Both prompts receive identical source payloads; no excerpt, relevance
label, retrieval parameter, sampling value or output budget was optimized.

The measured full prompts range from 1,481 to 3,047 tokens. Every full-prompt
roundtrip and both BOS encoding paths agree. The maximum plus 256 output tokens
and one native slot is 3,304, leaving 792 slots within 4,096. This is an offline
preflight result for the pinned research backend. It does not measure generated
answer quality, latency, GPU behavior, actor access or live server truncation.
Actual runtime accounting must still agree before a future smoke can receive
quality credit. The fixed private fixture remains
`83ecc2b40e95ca273c47b13225462f04d1148ca1ee78fcf28992c9f1b59a0408`.

Initial Ollama CLI version calls reported 0.21.2 on Yoga and 0.32.5 on Stealth.
Independent review established that this command calls the server metadata
API using inherited OLLAMA_HOST; those endpoints were not captured and these
observations do not establish installed ELF build versions. Preliminary report
fields are retained with an explicit correction. Final offline validation makes
no server or version calls. Cross-host verification uses the same isolated
byte-pinned metadata bundle and does not qualify or alter production backends. Both hosts verify the exact model manifest,
config and full 9.6-GB GGUF identity before using its vocabulary. Future inference
must bind a qualified backend/profile rather than silently mixing versions.

Negative checks cover truncated/zero/oversized frames, truncated payload,
missing BOS, a seventeenth input, invalid JSON, wrong model and enabled thinking.
CLJC checks cover missing identity verification, low headroom, incomplete frame
matrix, token-path disagreement, lost source payload, roundtrip failure and the
exact context/output-reserve boundary. Existing synthetic HTTP tests remain
separate; no new native MongoDB or actor result is claimed.

The first cross-host attempt found Yoga's existing exact fixture under the
previous final host stage rather than the original Stealth path. The harness
now uses that declared host-local path and revalidates its pinned bytes; it does
not regenerate or replace the frozen fixture. Initial metadata inspection also
triggered Go's automatic download of the source tag's Go 1.26 toolchain from an
installed Go 1.22 launcher. Those 240 MiB remain protected in the standard cache;
subsequent builds explicitly use the toolchain with `GOTOOLCHAIN=local`, a
task-owned build cache, one build worker and a timeout. No model was downloaded.
A first vocabulary hello probe used the existing local session; final host
measurements use Codex SSH requester loginuid 1002 and execution UID 1000.

## Remaining gates

The whole-repository strict lint backlog remains held, with the previous
fresh measurement again at zero errors and 7,783 warnings; the TypeScript
inventory passes with 558 active files and 787 entries. No SDK/compiled ANN or ranking artifact changed. The original ANN
false-empty replay result is not reclassified as proof of a historical engine
cause. Native model, modality and actor qualification remain open.

The owned model launch, read-only cache binding, endpoint ownership, fresh
resource admission and live token accounting are still required. The previous
CPU memory denial is historical; this metadata experiment is not a fresh model
admission. A separately versioned placement policy is still needed if that CPU
design does not fit Yoga. No shared production inference endpoint was used.

The same campaign retains four conservative reservation units of its original
30-unit cap. At 03:49 UTC official usage showed zero rate/assignments, the direct assignment
list was empty, and campaign bytes were unchanged. No Colab allocation or
measured new charge is claimed. Refresh
usage/assignments, budget law, bounds and cleanup before any later allocation.
Private source/binary manifests, commands, review, resource and native logs,
per-frame hashes/counts and recovery evidence live in
`ann-followup/e4b-token-retention-v1/`. Rendered private text is excluded from
public source. Active evidence and task-owned reference/dependency files remain
protected until verified recoverable.

Next: bind this exact profile to a reviewed owned model launch/cache/endpoint
controller and confirm fresh host admission before the two-case smoke. Continue
bounded lint repair independently; no merge, deployment, routing change, restart
or production activation is authorized.
