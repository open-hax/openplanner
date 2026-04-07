# OpenPlanner (API-first data lake)

Local-first personal data lake for LLM session archives with MongoDB as the single storage backend for structured data + vector persistence.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

The MongoDB backend requires:
- MongoDB 7.0+ with Atlas Vector Search or self-managed `mongot`
- Ollama or compatible embedding endpoint

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Health check |
| `GET /v1/health` | Detailed health status |
| `POST /v1/events` | Ingest events with automatic vector indexing |
| `POST /v1/search/fts` | Full-text search |
| `POST /v1/search/vector` | Vector similarity search |
| `GET /v1/sessions` | List sessions |
| `POST /v1/jobs/import/chatgpt` | Import ChatGPT data |
| `POST /v1/jobs/backfill/embeddings` | Rebuild all embeddings with GPU saturation |
| `POST /v1/jobs/compact/semantic` | Run semantic compaction |

Container-first workflow from the workspace root:

```bash
pnpm docker:stack up openplanner -- --build
pnpm docker:stack ps openplanner
pnpm docker:stack logs openplanner -- -f
```

When the root `ollama` stack is running, `openplanner` can use it over the shared `ai-infra` Docker network.

Auth header:

```
Authorization: Bearer <OPENPLANNER_API_KEY>
```

## GPU-Saturating Embedding Backfill

The `/v1/jobs/backfill/embeddings` endpoint rebuilds all embeddings with maximum GPU utilization:

```bash
# Set environment variables for maximum GPU utilization
export OLLAMA_EMBED_BATCH_WINDOW_MS=100
export OLLAMA_EMBED_MAX_BATCH_ITEMS=512

# Trigger backfill
curl -X POST http://localhost:7777/v1/jobs/backfill/embeddings \
  -H "Authorization: Bearer $OPENPLANNER_API_KEY"
```

**Configuration:**
- `OLLAMA_EMBED_BATCH_WINDOW_MS`: Time to collect items before embedding (default: 50ms, increase for larger batches)
- `OLLAMA_EMBED_MAX_BATCH_ITEMS`: Maximum items per embedding batch (default: 256)
- `OLLAMA_EMBED_MAX_CONCURRENT_BATCHES`: Concurrent GPU requests (default: 4)

The backfill uses:
- 16 concurrent document processors
- 256-item embedding batches (configurable)
- 4 parallel GPU workers per embedding function
- Pipelined MongoDB upserts (100 docs per batch)

## Data Retention (TTL)

MongoDB supports automatic data expiration via TTL indexes:

```bash
# Retain events for 30 days
export MONGODB_EVENTS_TTL_SECONDS=2592000

# Retain compacted memories for 90 days
export MONGODB_COMPACTED_TTL_SECONDS=7776000
```

Set to `0` (default) to disable TTL.

## Embedding Model Configuration

- `OLLAMA_EMBED_MODEL`: Default embedding model (default: `qwen3-embedding:0.6b`)
- `OLLAMA_COMPACT_EMBED_MODEL`: Model for compacted semantic packs
- `OLLAMA_EMBED_MODEL_BY_PROJECT`: Per-project overrides
- `OLLAMA_EMBED_MODEL_BY_SOURCE`: Per-source overrides
- `OLLAMA_EMBED_MODEL_BY_KIND`: Per-kind overrides

Override precedence: `project -> source -> kind -> default`

Override values accept either JSON (`{"chatgpt":"qwen3-embedding:4b"}`) or pair list (`chatgpt=qwen3-embedding:4b;discord=qwen3-embedding:0.6b`).

## Semantic Compaction

- `SEMANTIC_COMPACTION_ENABLED`: Enable/disable semantic compaction
- `SEMANTIC_COMPACTION_MIN_EVENTS`: Minimum events before compaction runs
- `SEMANTIC_COMPACTION_MAX_NEIGHBORS`: Maximum neighbors per seed
- `SEMANTIC_COMPACTION_CHAR_BUDGET`: Character budget per semantic pack
- `SEMANTIC_COMPACTION_DISTANCE_THRESHOLD`: Distance threshold for clustering
- `SEMANTIC_COMPACTION_MIN_CLUSTER_SIZE`: Minimum cluster size
- `SEMANTIC_COMPACTION_MAX_PACKS_PER_RUN`: Maximum packs per compaction run

## Vector Search

MongoDB vector collections are partitioned by model and dimensions:
- `event_chunks__<model>__d<dim>__<hash>` for hot/raw chunks
- `compacted_vectors__<model>__d<dim>__<hash>` for compacted vectors

Each partition gets its own Atlas Vector Search index with cosine similarity.

## Import/Export

Export to JSONL for backup:
```bash
node dist/cli.js export --output ./backup
```

Import from JSONL:
```bash
node dist/cli.js import --input ./backup
```
