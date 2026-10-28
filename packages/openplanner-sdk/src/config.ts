import type { SdkMutable } from "./types.js";

import path from "node:path";
import { parseModelMap, type EmbeddingModelConfig } from "./embedding-models.js";

export type SemanticCompactionConfig = SdkMutable<{
  readonly enabled: boolean;
  readonly minEventCount: number;
  readonly maxNeighbors: number;
  readonly maxChars: number;
  readonly distanceThreshold: number;
  readonly minClusterSize: number;
  readonly maxPacksPerRun: number;
}>;

export type MongoConfig = SdkMutable<{
  readonly uri: string;
  readonly dbName: string;
  readonly eventsCollection: string;
  readonly compactedCollection: string;
  readonly vectorHotCollection: string;
  readonly vectorCompactCollection: string;
  readonly graphLayoutCollection: string;
  readonly graphNodeEmbeddingCollection: string;
  readonly eventsTtlSeconds?: number;
  readonly compactedTtlSeconds?: number;
}>;

export type OpenPlannerConfig = SdkMutable<{
  readonly dataDir: string;
  readonly host: string;
  readonly port: number;
  readonly apiKey: string;
  readonly embedProviderBaseUrl: string;
  readonly embedProviderApiKey?: string;
  readonly embeddingModels: EmbeddingModelConfig;
  readonly compactEmbedModel: string;
  readonly embedProviderBatchWindowMs: number;
  readonly embedProviderMaxBatchItems: number;
  readonly embedProviderCachePath: string;
  readonly semanticCompaction: SemanticCompactionConfig;
  readonly mongodb: MongoConfig;
}>;

function mustGet(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function loadConfig(): OpenPlannerConfig {
  const dataDir = mustGet("OPENPLANNER_DATA_DIR", "./openplanner-lake");
  const host = mustGet("OPENPLANNER_HOST", "127.0.0.1");
  const port = Number(mustGet("OPENPLANNER_PORT", "7777"));
  const apiKey = mustGet("OPENPLANNER_API_KEY", "change-me");
  const embedProviderBaseUrl = mustGet("EMBED_PROVIDER_BASE_URL", "http://host.docker.internal:8789");
  const embedProviderApiKey = process.env.EMBED_PROVIDER_API_KEY
    ?? process.env.OPEN_HAX_OPENAI_PROXY_AUTH_TOKEN ?? undefined;
  const defaultEmbedModel = mustGet("EMBED_PROVIDER_MODEL", "qwen3-embedding:0.6b");
  const compactEmbedModel = mustGet("EMBED_PROVIDER_COMPACT_MODEL", defaultEmbedModel);
  const embedProviderBatchWindowMs = parsePositiveInt(process.env.EMBED_PROVIDER_BATCH_WINDOW_MS, 50);
  const embedProviderMaxBatchItems = parsePositiveInt(process.env.EMBED_PROVIDER_MAX_BATCH_ITEMS, 256);
  const embedProviderCachePath = mustGet(
    "EMBED_PROVIDER_CACHE_PATH", path.join(dataDir, "cache", "embed-provider-cache.jsonl"),
  );
  const embeddingModels: EmbeddingModelConfig = {
    defaultModel: defaultEmbedModel,
    bySource: parseModelMap(process.env.EMBED_PROVIDER_MODEL_BY_SOURCE),
    byKind: parseModelMap(process.env.EMBED_PROVIDER_MODEL_BY_KIND),
    byProject: parseModelMap(process.env.EMBED_PROVIDER_MODEL_BY_PROJECT)
  };
  const semanticCompaction: SemanticCompactionConfig = {
    enabled: parseBool(process.env.SEMANTIC_COMPACTION_ENABLED, true),
    minEventCount: parsePositiveInt(process.env.SEMANTIC_COMPACTION_MIN_EVENTS, 1500),
    maxNeighbors: parsePositiveInt(process.env.SEMANTIC_COMPACTION_MAX_NEIGHBORS, 24),
    maxChars: parsePositiveInt(process.env.SEMANTIC_COMPACTION_CHAR_BUDGET, 16000),
    distanceThreshold: parsePositiveNumber(process.env.SEMANTIC_COMPACTION_DISTANCE_THRESHOLD, 0.35),
    minClusterSize: parsePositiveInt(process.env.SEMANTIC_COMPACTION_MIN_CLUSTER_SIZE, 4),
    maxPacksPerRun: parsePositiveInt(process.env.SEMANTIC_COMPACTION_MAX_PACKS_PER_RUN, 256),
  };

  const eventsTtlSeconds = parsePositiveInt(process.env.MONGODB_EVENTS_TTL_SECONDS, 0);
  const compactedTtlSeconds = parsePositiveInt(process.env.MONGODB_COMPACTED_TTL_SECONDS, 0);

  const mongodb: MongoConfig = {
    uri: mustGet("MONGODB_URI", "mongodb://localhost:27017"),
    dbName: mustGet("MONGODB_DB", "openplanner"),
    eventsCollection: mustGet("MONGODB_EVENTS_COLLECTION", "events"),
    compactedCollection: mustGet("MONGODB_COMPACTED_COLLECTION", "compacted_memories"),
    vectorHotCollection: mustGet("MONGODB_VECTOR_HOT_COLLECTION", "event_chunks"),
    vectorCompactCollection: mustGet("MONGODB_VECTOR_COMPACT_COLLECTION", "compacted_vectors"),
    graphLayoutCollection: mustGet("MONGODB_GRAPH_LAYOUT_COLLECTION", "graph_layout_overrides"),
    graphNodeEmbeddingCollection: mustGet("MONGODB_GRAPH_NODE_EMBEDDING_COLLECTION", "graph_node_embeddings"),
    eventsTtlSeconds: eventsTtlSeconds > 0 ? eventsTtlSeconds : undefined,
    compactedTtlSeconds: compactedTtlSeconds > 0 ? compactedTtlSeconds : undefined,
  };

  return {
    dataDir: path.resolve(dataDir),
    host,
    port,
    apiKey,
    embedProviderBaseUrl,
    embedProviderApiKey,
    embeddingModels,
    compactEmbedModel,
    embedProviderBatchWindowMs,
    embedProviderMaxBatchItems,
    embedProviderCachePath: path.resolve(embedProviderCachePath),
    semanticCompaction,
    mongodb,
  };
}
