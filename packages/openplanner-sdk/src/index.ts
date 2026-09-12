/**
 * @open-hax/openplanner-sdk
 *
 * Curated barrel: the high-level SDK surface. Lower-level modules are
 * available as subpath imports (e.g. "@open-hax/openplanner-sdk/mongodb",
 * ".../mongo-vectors", ".../embeddings") — the root barrel deliberately does
 * not `export *` everything because module-level names overlap (e.g. both
 * config and mongodb export a MongoConfig shape).
 */
export { createOpenPlannerSdk } from "./sdk.js";
export type { OpenPlannerSdk, OpenPlannerSdkOptions } from "./sdk.js";

export { loadConfig } from "./config.js";
export type { OpenPlannerConfig } from "./config.js";

export { openMongoDB, closeMongoDB } from "./mongodb.js";
export type { MongoConnection } from "./mongodb.js";

export { createEmbeddingRuntime } from "./embedding-runtime.js";
export type { EmbeddingRuntime } from "./embedding-runtime.js";

export { createProtocols } from "./protocol-adapters.js";
export type { ProtocolContext, Protocols, EventAdmission, SessionManagement, TenantManagement } from "./protocol-adapters.js";

export { ingestEvents, validateEvent, shouldIndexEventHotVectors } from "./ingest.js";
export type { IngestContext, IngestLogger, IngestResult } from "./ingest.js";

export { ftsSearchWithQuality, vectorSearchWithQuality, qualityMode } from "./search-core.js";
export type { SearchContext, QualityMode } from "./search-core.js";

export { listSessionsResponse, getSessionResponse } from "./sessions-core.js";
export type { SessionsContext, SessionDetailMode } from "./sessions-core.js";

export { listCollectionsResponse, queryCollectionResponse, sanitizeCollectionName } from "./mongo-browse.js";

export type { EventEnvelopeV1, EventIngestRequest, FtsSearchRequest, VectorSearchRequest } from "./types.js";
