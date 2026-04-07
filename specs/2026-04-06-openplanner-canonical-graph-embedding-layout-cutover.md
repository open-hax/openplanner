# OpenPlanner Canonical Graph + Embedding + Layout Cutover

## Status
Draft

## Parent specs

- `orgs/open-hax/openplanner/specs/2026-04-05-mongodb-only-reversible-migration.md`
- `orgs/open-hax/knoxx/specs/knowledge-ops-mongodb-vector-unification.md`
- `orgs/open-hax/openplanner/specs/openplanner-graph-events.md`
- `orgs/open-hax/openplanner/specs/openplanner-web-edge-salience-and-backbone-projections.md`

## Purpose

Finish the cutover to a **single durable storage authority** for the Knoxx graph runtime.

OpenPlanner becomes the only durable home for:

- graph nodes
- graph edges
- document and event content
- embeddings
- layout overrides

`graph-weaver`, `eros-eris-field-app`, and `myrmex` become runtime workers and query surfaces around that lake instead of owning parallel persistence systems.

## Design rule

OpenPlanner is the only durable store.

Redis may exist as a transient queue / coalescing layer, but it is **not** a second lake.

If Redis disappears:

- no durable graph truth is lost
- no canonical embedding is lost
- only in-flight buffered layout deltas or pending batch work may need replay

## Problem statement

Today the graph runtime is split across too many ownership domains:

1. OpenPlanner already stores graph receipts and vector chunks.
2. Graph Weaver still persists `web` and `user` graph layers in its own MongoDB.
3. Eros re-fetches previews, re-embeds content on the hot path, then writes layout back at a rate the durable sink cannot absorb.
4. The hot path names the embedding endpoint as `OLLAMA_*` even when the actual transport boundary is Proxx, which makes auth drift and runtime confusion more likely.

This creates four concrete failures:

- duplicated persistence ownership
- accelerator starvation from re-embedding + preview fetch
- too-frequent durable layout writes
- operational ambiguity about which service owns truth

## Decision summary

### 1. OpenPlanner becomes the canonical authority

OpenPlanner owns:

- append-only graph receipts (`graph.node`, `graph.edge`)
- document/event text and metadata
- chunk embeddings
- representative node embeddings
- layout overrides

### 2. Graph Weaver stops owning durable graph state

Graph Weaver becomes:

- an in-memory merged graph surface
- a renderer/query API for clients
- a consumer of OpenPlanner graph export + layout state

Graph Weaver should not run its own MongoDB instance once cutover is complete.

### 3. Eros stops embedding on the hot path

Eros should:

- fetch canonical node embeddings from OpenPlanner
- use VEXX for similarity/top-k/matrix work
- simulate layout locally
- send layout deltas back to OpenPlanner

Eros should not fetch arbitrary node previews and call Proxx embeddings for steady-state graph layout.

### 4. Redis is added to OpenPlanner for transient write-behind

Redis may buffer:

- high-frequency layout updates
- optional embedding/materialization backlog work
- optional graph projection refresh work

Redis must never become the only copy of graph, embedding, or layout truth.

## Current transitional state

### Already true

- OpenPlanner already exports canonical graph state through `GET /v1/graph/export`.
- OpenPlanner already indexes event/document text into Mongo vector collections in Mongo mode.
- Graph Weaver can already rebuild its local graph view from OpenPlanner export.

### Still transitional

- Graph Weaver persists `web` and `user` layers through `MongoGraphStore`.
- Eros fetches node previews from Graph Weaver and embeds content directly.
- Layout writes happen directly on the high-frequency render/sim path.
- Proxx-backed embedding config is still named as `OLLAMA_*` in Eros.

## Target ownership model

## OpenPlanner

OpenPlanner owns all durable state for the graph runtime.

### Durable entities

- raw `graph.node` events
- raw `graph.edge` events
- graph-node representative embedding projection
- graph layout override projection
- document/event chunk vectors
- derived graph export/query views

### Durable invariants

- every graph node has a stable `node_id`
- every durable embedding record names its source event / document parent
- every layout row is keyed by `node_id`
- layout writes are last-write-wins unless explicit version checks are requested

## Redis

Redis is an optional transient accelerator for OpenPlanner.

### Allowed roles

- coalesce repeated layout writes by `node_id`
- queue batched flush jobs
- hold pending backfill work

### Forbidden roles

- canonical graph storage
- canonical embedding storage
- canonical layout storage

## Myrmex

Myrmex is an append-only graph receipt producer.

It should:

- emit `graph.node` events with stable node identifiers, normalized URLs, and content hashes
- emit `graph.edge` events with stable `source_node_id` / `target_node_id` when possible
- never write directly to Graph Weaver persistence

## Graph Weaver

Graph Weaver is a graph workbench surface.

It should:

- read canonical nodes/edges from OpenPlanner
- read canonical layout overrides from OpenPlanner
- keep only in-memory render caches and derived merged views locally
- never own the durable `web` or `user` graph layers

## Eros / Eris

Eros is a layout worker.

It should:

- read graph export from OpenPlanner or Graph Weaver's OpenPlanner-backed merged view
- fetch representative node embeddings from OpenPlanner
- call VEXX to score similarity
- write layout deltas to OpenPlanner

It should not:

- fetch page/file previews for steady-state embedding generation
- call Proxx embeddings in the normal layout loop after cutover
- write directly to Graph Weaver-owned persistence

## Required OpenPlanner data additions

## 1. Graph node embedding projection

Add a dedicated logical vector family for representative graph-node embeddings.

Suggested env:

- `MONGODB_VECTOR_GRAPH_NODE_COLLECTION=graph_node_vectors`

Suggested logical row shape:

```json
{
  "node_id": "web:url:https://example.com/article",
  "source_event_id": "graph.node:123",
  "project": "web",
  "content_hash": "sha256:abc123",
  "embedding_model": "qwen3-embedding:0.6b",
  "embedding_dimensions": 1024,
  "representation_kind": "node_representative_v1",
  "text_preview": "optional short debug preview",
  "embedding": [0.1, -0.2, ...],
  "updated_at": "2026-04-06T...Z"
}
```

### Rules

- one latest representative embedding per `(node_id, embedding_model, embedding_dimensions)`
- derived from canonical node/document content inside OpenPlanner
- recomputed when content hash changes
- queryable directly by `node_id`

This projection exists so layout workers do not have to reconstruct node semantics from chunk collections on every cycle.

## 2. Graph layout override projection

Add a dedicated durable collection for latest layout state.

Suggested collection:

- `graph_layout_overrides`

Suggested row shape:

```json
{
  "node_id": "web:url:https://example.com/article",
  "x": 120.4,
  "y": -88.2,
  "layout_source": "eros-eris-field-app",
  "layout_version": "v1",
  "updated_at": "2026-04-06T...Z"
}
```

### Rules

- latest write wins by `node_id`
- writes are upserts, not append-only history, unless a later audit requirement says otherwise
- Graph export may inline current layout for convenience, but the authoritative source remains this collection

## 3. Optional graph projection state

If Graph Weaver still needs lightweight user annotations after Mongo removal, those annotations should also move into OpenPlanner under an explicit graph overlay collection instead of remaining in Graph Weaver-local Mongo.

This spec does **not** require overlay history yet; it requires only that Graph Weaver no longer owns durability.

## Required OpenPlanner API additions

## 1. `GET /v1/graph/export`

Extend existing export so callers can request layout state directly.

Suggested additions:

- `includeLayout=true`
- `includeRepresentativeEmbeddings=false` by default

Returned nodes should optionally include:

```json
{
  "id": "web:url:https://example.com/article",
  "data": {
    "pos": { "x": 120.4, "y": -88.2 },
    "event_id": "graph.node:123"
  }
}
```

## 2. `GET /v1/graph/layout`

Purpose: low-cost fetch of current layout state without full graph export.

Suggested query forms:

```http
GET /v1/graph/layout?ids=web:url:https://example.com/article,devel:file:README.md
GET /v1/graph/layout?projects=devel,web
```

## 3. `POST /v1/graph/layout/upsert`

Purpose: accept batched layout deltas from Eros and other layout workers.

Suggested body:

```json
{
  "source": "eros-eris-field-app",
  "layoutVersion": "v1",
  "inputs": [
    { "id": "web:url:https://example.com/article", "x": 120.4, "y": -88.2 },
    { "id": "devel:file:README.md", "x": -44.1, "y": 20.0 }
  ]
}
```

Semantics:

- validate numeric coordinates
- enqueue/coalesce in Redis if enabled
- flush to durable store in bulk
- return count accepted / count flushed

## 4. `POST /v1/graph/node-embeddings/query`

Purpose: fetch representative embeddings by node id.

Suggested body:

```json
{
  "ids": [
    "web:url:https://example.com/article",
    "devel:file:services/openplanner/README.md"
  ],
  "model": "qwen3-embedding:0.6b"
}
```

Suggested response:

```json
{
  "ok": true,
  "vectors": [
    {
      "id": "web:url:https://example.com/article",
      "sourceEventId": "graph.node:123",
      "embeddingModel": "qwen3-embedding:0.6b",
      "embeddingDimensions": 1024,
      "embedding": [0.1, -0.2, ...]
    }
  ],
  "missing": ["devel:file:services/openplanner/README.md"]
}
```

## 5. `POST /v1/graph/node-embeddings/backfill`

Purpose: backfill or refresh representative embeddings after cutover or content-hash changes.

This may be synchronous for tiny requests or job-backed for bulk ranges.

## Redis contract inside OpenPlanner

## Phase-1 requirement: layout coalescing only

Minimum Redis use should be layout write-behind.

Suggested key pattern:

- `openplanner:graph:layout:pending` — hash `node_id -> latest JSON payload`
- `openplanner:graph:layout:dirty` — set of dirty node ids
- `openplanner:graph:layout:flush-lock` — short-lived lock key

## Write semantics

### Accept path

`POST /v1/graph/layout/upsert`:

1. normalizes ids and coordinates
2. overwrites any prior pending payload for the same `node_id`
3. marks the node dirty
4. optionally triggers flush when thresholds are crossed

### Flush path

A background flusher:

1. claims a batch of dirty ids
2. loads the latest pending payloads
3. bulk upserts into Mongo
4. deletes only successfully flushed ids from pending structures

### Failure semantics

- if durable write fails, pending Redis entries remain
- if Redis is unavailable, the API may either fail fast or write directly to Mongo in degraded mode
- if Redis is lost, canonical layout can be re-driven by Eros, but in-flight pending deltas may be lost

## Optional later Redis roles

Not required for the initial cutover, but compatible:

- representative-embedding backfill queue
- graph projection rebuild queue
- graph export warm-cache invalidation queue

## Service-specific changes

## Graph Weaver changes

### Remove

- `MongoGraphStore`
- Graph Weaver-owned `mongodb` service in the Knoxx stack
- durable `web` and `user` writes inside Graph Weaver server code

### Keep

- in-memory `GraphStore`
- GraphQL query surface
- render sampling/layout cache
- OpenPlanner-backed graph rebuild path

### Replace with

- OpenPlanner graph export for canonical nodes/edges
- OpenPlanner layout endpoints for latest positions
- optional OpenPlanner overlay endpoints if user annotations remain necessary

## Eros changes

### Remove

- steady-state `fetchNodePreviews(...)`
- steady-state `ollamaEmbedMany(...)` hot-path usage
- direct layout writes to Graph Weaver-owned persistence

### Replace with

- `POST /v1/graph/node-embeddings/query`
- VEXX cosine/top-k/matrix scoring over returned vectors
- `POST /v1/graph/layout/upsert`

### Config normalization

Rename config surface to describe the real boundary:

- `PROXX_BASE_URL`
- `PROXY_AUTH_TOKEN`
- `PROXX_EMBED_MODEL`

Backwards-compatible aliases may remain temporarily:

- `OLLAMA_URL`
- `OLLAMA_AUTH_TOKEN`
- `OLLAMA_MODEL`

but new docs and compose wiring should prefer the Proxx names.

## Myrmex changes

Myrmex should continue to emit graph receipts into OpenPlanner, but should prefer including:

- stable `node_id`
- normalized URL
- content hash
- source/target node ids on edges

This reduces downstream ID synthesis and prevents layout/embedding identity drift.

## Cutover phases

## Phase 0 — Contract first

- add this cutover spec
- bless `OPENPLANNER_STORAGE_BACKEND=mongodb` as the required graph-runtime mode
- document Graph Weaver Mongo as transitional only

## Phase 1 — OpenPlanner layout + node-embedding APIs

- add `graph_layout_overrides` collection
- add representative node-embedding projection + backfill job
- add `GET /v1/graph/layout`
- add `POST /v1/graph/layout/upsert`
- add `POST /v1/graph/node-embeddings/query`

## Phase 2 — Redis write-behind inside OpenPlanner

- add Redis service to OpenPlanner stack
- implement layout coalescing + batch flush
- add health reporting for Redis and layout flusher state

## Phase 3 — Graph Weaver read-only cutover

- switch Graph Weaver durable layout reads to OpenPlanner
- disable Graph Weaver Mongo writes behind a flag
- remove `MongoGraphStore` usage from the normal path

## Phase 4 — Eros semantic cutover

- replace preview-fetch + embed loop with OpenPlanner node-embedding fetch
- keep VEXX scoring path
- send only layout deltas to OpenPlanner
- verify that steady-state Eros no longer needs direct Proxx embedding calls

## Phase 5 — Remove duplicate persistence

- remove Graph Weaver Mongo container/service from Knoxx compose
- remove Graph Weaver Mongo startup/config code
- remove legacy Eros preview embedding path or demote it to explicit recovery/backfill tooling

## Verification

## Functional

- `POST /v1/events` with `graph.node` produces graph node export and representative embedding after materialization
- `GET /v1/graph/export?includeLayout=true` returns canonical positions from OpenPlanner
- `POST /v1/graph/layout/upsert` coalesces repeated writes for the same node id
- `POST /v1/graph/node-embeddings/query` returns vectors for existing graph nodes
- Graph Weaver renders correctly without its own Mongo persistence
- Eros produces semantic pairs from OpenPlanner-fetched vectors and VEXX scoring

## Operational

- OpenPlanner health reports Mongo vector state, VEXX health, and Redis health when enabled
- Graph Weaver no longer requires a MongoDB service in the Knoxx stack
- Eros no longer crashes due to missing Proxx auth token in steady-state layout mode because it no longer owns steady-state embedding generation

## Performance

- layout write latency is bounded by batch flush cadence rather than per-tick direct durable writes
- representative embedding lookup is materially cheaper than preview fetch + embed generation
- VEXX utilization increases because the device is fed from already-materialized vectors

## Definition of done

- OpenPlanner is the only durable store for graph, embedding, and layout state
- Graph Weaver has no dedicated MongoDB runtime dependency
- Eros uses OpenPlanner-sourced embeddings and VEXX similarity scoring
- Redis, if enabled, is purely transient write-behind / queueing infrastructure
- the Knoxx graph runtime has one durable truth boundary instead of several