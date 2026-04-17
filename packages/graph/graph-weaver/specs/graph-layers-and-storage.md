# Graph Layers and Storage Spec

## Purpose

Make the internal graph layering explicit.

## Three graph layers

### 1. Local layer
Produced by repo scan.

Sources:
- tracked files
- markdown links
- JS/TS imports
- Python imports
- Clojure requires

Characteristics:
- deterministic rebuild from repo state
- `layer: local`
- seeds external URLs found in markdown

### 2. Web layer
Produced by crawler events coming from `graph-weaver-aco`.

Characteristics:
- `url:*` nodes
- outgoing web edges
- page/error metadata
- persisted to Mongo under store `web`

### 3. User layer
Produced by explicit user mutations.

Characteristics:
- overlay nodes and edges
- layout position overrides
- user-authored graph edits
- persisted to Mongo under store `user`

## Merge model

The runtime merges:
- `localStore`
- `webStore`
- `userStore`

Merged graph is cached until invalidated by a dirty mark.

## Storage backends

### In-memory
All three layers are active in memory via `GraphStore`.

### MongoDB
`MongoGraphStore` persists:
- nodes by `store + id`
- edges by `store + id`
- indexes on `store/id`, `store/source`, `store/target`

### Runtime files
Config and legacy user graph state live in runtime paths such as:
- `.opencode/runtime/devel-graph-weaver.config.json`
- `.opencode/runtime/devel-graph-weaver.user-graph.json`

## Design consequence

This repo is not a pure cache or a pure derivation engine.
It is a layered graph instrument that intentionally combines:
- rebuildable derivation
- discovered external state
- human-authored overlay
