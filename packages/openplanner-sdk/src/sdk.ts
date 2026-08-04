/**
 * High-level SDK entry point.
 *
 * createOpenPlannerSdk() gives an internal consumer (knoxx, workers, scripts)
 * the full OpenPlanner data plane — event ingest, FTS/vector search, session
 * queries, raw mongo access — over a direct MongoDB connection with
 * self-sourced embeddings (EMBED_PROVIDER_*). No REST API involved: the REST
 * server itself is just another consumer of this library, kept for external
 * clients that cannot be granted database access.
 */
import { loadConfig } from "./config.js";
import type { OpenPlannerConfig } from "./config.js";
import { openMongoDB, closeMongoDB } from "./mongodb.js";
import type { MongoConnection } from "./mongodb.js";
import { createEmbeddingRuntime } from "./embedding-runtime.js";
import type { EmbeddingRuntime } from "./embedding-runtime.js";
import { createProtocols } from "./protocol-adapters.js";
import type { Protocols } from "./protocol-adapters.js";
import { ingestEvents } from "./ingest.js";
import type { IngestLogger, IngestResult } from "./ingest.js";
import { ftsSearchWithQuality, vectorSearchWithQuality } from "./search-core.js";
import type { EventEnvelopeV1, FtsSearchRequest, VectorSearchRequest } from "./types.js";

export interface OpenPlannerSdkOptions {
  /**
   * Config overrides merged over loadConfig() (which reads OPENPLANNER_* /
   * MONGODB_* / EMBED_PROVIDER_* env vars). Pass { mongodb: { uri, ... } } to
   * point at a specific deployment without touching process.env.
   */
  config?: Partial<OpenPlannerConfig> & { mongodb?: Partial<OpenPlannerConfig["mongodb"]> };
  log?: IngestLogger;
}

export interface OpenPlannerSdk {
  config: OpenPlannerConfig;
  mongo: MongoConnection;
  embeddingRuntime: EmbeddingRuntime;
  protocols: Protocols;
  ingestEvents(events: EventEnvelopeV1[]): Promise<IngestResult>;
  searchFts(body: FtsSearchRequest): ReturnType<typeof ftsSearchWithQuality>;
  searchVector(body: VectorSearchRequest): ReturnType<typeof vectorSearchWithQuality>;
  listSessions(opts: { project?: string; limit: number; offset: number }): Promise<{ rows: any[]; total: number }>;
  getSessionEvents(sessionId: string, opts: Record<string, unknown>): Promise<any[]>;
  listCollections(): Promise<string[]>;
  close(): Promise<void>;
}

export async function createOpenPlannerSdk(options: OpenPlannerSdkOptions = {}): Promise<OpenPlannerSdk> {
  const base = loadConfig();
  const config: OpenPlannerConfig = {
    ...base,
    ...(options.config ?? {}),
    mongodb: { ...base.mongodb, ...(options.config?.mongodb ?? {}) },
  };

  const mongo = await openMongoDB(config.mongodb);
  const embeddingRuntime = createEmbeddingRuntime(config);
  const protocols = createProtocols({ mongo });
  const log = options.log;

  return {
    config,
    mongo,
    embeddingRuntime,
    protocols,
    ingestEvents: (events) => ingestEvents({ mongo, embeddingRuntime, log }, events),
    searchFts: (body) => ftsSearchWithQuality({ mongo, embeddingRuntime }, body),
    searchVector: (body) => vectorSearchWithQuality({ mongo, embeddingRuntime }, body),
    listSessions: (opts) => protocols.sessionManagement.listSessions(opts),
    getSessionEvents: (sessionId, opts) => protocols.sessionManagement.getSessionEvents(sessionId, opts),
    listCollections: async () => {
      const collections = await mongo.db.listCollections().toArray();
      return collections.map((c: { name: string }) => c.name).sort();
    },
    close: () => closeMongoDB(mongo),
  };
}
