# Π Fork Tax — openplanner pointer freeze for Knoxx audio work

Timestamp: 20260506T231041Z
Repo: /home/err/devel/orgs/open-hax/openplanner
Branch: tests/sentance-chunker
Base HEAD: 1c50cdc
Tag target: pi-fork-tax-openplanner-knoxx-audio-20260506T231041Z

## Preserved submodule pointer
- `packages/agents/knoxx` -> `011a145b352b5a595b7093a0ee73e811f1cda82a` (`Π freeze broadcast studio audio hearing`)
- Knoxx tag: `pi-fork-tax-broadcast-audio-20260506T231041Z`

## Why this exists
The working Broadcast Studio audio fix lives in the rank-3 Knoxx submodule. This parent repo commit pins the openplanner submodule pointer so the frozen Knoxx commit is reachable from the openplanner tree.

## Concurrent dirt intentionally not absorbed
OpenPlanner has unrelated dirty files in graph/routes/embeddings/docker-compose/spec areas. This commit stages only the Knoxx submodule pointer and `.ημ` fork-tax artifacts.
