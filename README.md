# OpenPlanner (API-first data lake)

Local-first personal data lake for LLM session archives with:

- **DuckDB + ChromaDB** as the legacy stack
- **MongoDB-only mode** as the replacement stack for structured data + vector persistence
- reversible migration tooling between legacy and MongoDB-only storage

This is a complete runnable **project skeleton**. See `specs/` for scope.

## Quick start

```bash
npm install
docker compose up -d
cp .env.example .env
npm run dev
```

With MongoDB backend:
```bash
docker compose --profile mongodb up -d
export OPENPLANNER_STORAGE_BACKEND=mongodb
npm run dev
```

The MongoDB profile now brings up:

- `mongodb` in replica-set mode
- `mongot` for self-managed search/vector search
- `mongo-init` to initialize `rs0`

## Reversible migration commands

```bash
# structured data only
node dist/migrate.js duckdb-to-mongo
node dist/migrate.js mongo-to-duckdb

# vectors only
node dist/migrate.js chroma-to-mongo
node dist/migrate.js mongo-to-chroma

# full stack round-trips
node dist/migrate.js legacy-to-mongo
node dist/migrate.js mongo-to-legacy
```

Add `--dry-run` to inspect counts without writing.

Design note: the long-term unification target is captured in `specs/2026-04-05-mongodb-only-reversible-migration.md` and `../knoxx/specs/knowledge-ops-mongodb-vector-unification.md`.
Current Mongo mode removes Chroma from runtime storage and uses model/dimension-partitioned Mongo vector collections with native `$vectorSearch` where available, falling back to application-side cosine scan if `mongot`/search indexes are unavailable or still building.

## Data Retention (TTL)

MongoDB supports automatic data expiration via TTL indexes:

```bash
# Retain events for 30 days
export MONGODB_EVENTS_TTL_SECONDS=2592000

# Retain compacted memories for 90 days
export MONGODB_COMPACTED_TTL_SECONDS=7776000
```

Set to `0` (default) to disable TTL.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Health check |
| `GET /v1/health` | Detailed health status |
| `POST /v1/events` | Ingest events |
| `POST /v1/search/fts` | Full-text search |
| `POST /v1/search/vector` | Vector search (`ChromaDB` on legacy, MongoDB vector collections on Mongo mode) |
| `GET /v1/sessions` | List sessions |
| `POST /v1/jobs/import/chatgpt` | Import ChatGPT data |

Container-first workflow from the workspace root:

```bash
pnpm docker:stack up openplanner -- --build
pnpm docker:stack ps openplanner
pnpm docker:stack logs openplanner -- -f
```

In legacy mode this stack owns both the `openplanner` app on `7777` and `chroma` on `8000`.
If `8000` is already in use on the host, override it with `OPENPLANNER_CHROMA_PORT=<port>`.
In MongoDB mode, Chroma is no longer required at runtime.
When the root `ollama` stack is running, `openplanner` can use it over the shared `ai-infra` Docker network.

Auth header:

```
Authorization: Bearer <OPENPLANNER_API_KEY>
```

Embedding model selection knobs:

- `OLLAMA_EMBED_MODEL`: hot/raw collection model
- `OLLAMA_EMBED_MODEL_BY_PROJECT`: per-project overrides for the hot/raw collection
- `OLLAMA_EMBED_MODEL_BY_SOURCE`: per-source overrides for the hot/raw collection
- `OLLAMA_EMBED_MODEL_BY_KIND`: per-kind overrides for the hot/raw collection
- `CHROMA_COMPACT_COLLECTION`: legacy compacted semantic collection
- `OLLAMA_COMPACT_EMBED_MODEL`: embedding model for compacted semantic packs
- `MONGODB_VECTOR_HOT_COLLECTION`: base MongoDB hot/raw vector chunk collection prefix
- `MONGODB_VECTOR_COMPACT_COLLECTION`: base MongoDB compacted vector collection prefix

Override precedence for the hot/raw collection is `project -> source -> kind -> default`.
Override values accept either JSON (`{"chatgpt":"qwen3-embedding:4b"}`) or pair list (`chatgpt=qwen3-embedding:4b;discord=qwen3-embedding:0.6b`).

Semantic compaction knobs:

- `SEMANTIC_COMPACTION_ENABLED`
- `SEMANTIC_COMPACTION_MIN_EVENTS`
- `SEMANTIC_COMPACTION_MAX_NEIGHBORS`
- `SEMANTIC_COMPACTION_CHAR_BUDGET`
- `SEMANTIC_COMPACTION_DISTANCE_THRESHOLD`
- `SEMANTIC_COMPACTION_MIN_CLUSTER_SIZE`
- `SEMANTIC_COMPACTION_MAX_PACKS_PER_RUN`

## Endpoints (MVP)

- `POST /v1/blobs` (multipart) -> sha256
- `GET /v1/blobs/:sha256`
- `POST /v1/events` -> upsert events into DuckDB
- `POST /v1/search/fts` -> keyword search
- `POST /v1/search/vector` -> vector search (legacy Chroma, or MongoDB vector collections in Mongo mode)
- `GET /v1/sessions`
- `GET /v1/sessions/:sessionId`
- `GET /v1/jobs` + job creation stubs

See `spec/01-api-contract.md`.
