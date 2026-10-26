import type { Collection } from "mongodb";
import type { IEmbeddingFunction } from "./embeddings.js";
import { formatEmbeddingQueryText } from "./embedding-text.js";
import type { MongoConnection, MongoVectorDocument, MongoVectorPartitionDocument } from "./mongodb.js";
import type { MongoVectorTier, RawQueryResult } from './mongo-vector-data.js';
import { emptyResult, hydrateVectorDocumentText, buildMongoFilter, cosineSimilarity, toMetadata } from './mongo-vector-data.js';
import { listMongoVectorPartitions } from './mongo-vector-partitions.js';

export const VEXX_BASE_URL = String(process.env.VEXX_BASE_URL ?? "").trim();

export const VEXX_API_KEY = String(process.env.VEXX_API_KEY ?? "").trim();

export const VEXX_DEVICE = String(process.env.VEXX_DEVICE ?? "AUTO").trim() || "AUTO";

export const VEXX_REQUIRE_ACCEL = /^(1|true|yes|on)$/i.test(String(process.env.VEXX_REQUIRE_ACCEL ?? ""));

export const VEXX_ENFORCE = /^(1|true|yes|on)$/i.test(String(process.env.VEXX_ENFORCE ?? ""));

export const VEXX_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.VEXX_TIMEOUT_MS ?? "1500");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1500;
})();

export const VEXX_MIN_CANDIDATES = (() => {
  const parsed = Number(process.env.VEXX_MIN_CANDIDATES ?? "256");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 256;
})();

export function vexxRequiredError(context: string): Error {
  return new Error(`vexx_required:${context}`);
}

export async function queryPartitionWithVexxTopK(params: {
  readonly candidates: readonly MongoVectorDocument[];
  readonly queryEmbedding: readonly number[];
  readonly k: number;
}): Promise<ReadonlyArray<{ readonly doc: MongoVectorDocument; readonly score: number }> | null> {
  if (!VEXX_BASE_URL) return null;
  const validCandidates = params.candidates.filter(
    (doc) => Array.isArray(doc.embedding) && doc.embedding.length === params.queryEmbedding.length,
  );
  if (validCandidates.length < Math.max(params.k, VEXX_MIN_CANDIDATES)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VEXX_TIMEOUT_MS);
  const response = await fetch(`${VEXX_BASE_URL.replace(/\/$/, "")}/v1/cosine/topk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(VEXX_API_KEY ? { Authorization: `Bearer ${VEXX_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        query: params.queryEmbedding,
        candidates: validCandidates.map((doc) => ({ id: doc._id, embedding: doc.embedding })),
        k: Math.max(1, params.k),
        device: VEXX_DEVICE,
        requireAccel: VEXX_REQUIRE_ACCEL,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

  if (!response.ok) return null;

  const payload = await response.json() as {
    readonly matches?: ReadonlyArray<{ readonly id?: string; readonly score?: number }>;
  };
  if (!Array.isArray(payload.matches)) return null;

  const docsById = new Map(validCandidates.map((doc) => [doc._id, doc]));
  return payload.matches
    .map((match) => {
      const id = typeof match.id === "string" ? match.id : "";
      const score = typeof match.score === "number" ? match.score : Number.NEGATIVE_INFINITY;
      const doc = docsById.get(id);
      return doc ? { doc, score } : null;
    })
    .filter((entry): entry is { readonly doc: MongoVectorDocument; readonly score: number } =>
      entry !== null && Number.isFinite(entry.score));
}

export async function queryPartitionWithNativeVectorSearch(params: {
  readonly collection: Collection<MongoVectorDocument>;
  readonly partition: MongoVectorPartitionDocument;
  readonly queryEmbedding: readonly number[];
  readonly k: number;
  readonly where?: Record<string, unknown>;
  readonly exact?: boolean;
}): Promise<ReadonlyArray<{ readonly doc: MongoVectorDocument; readonly score: number }>> {
  const filter = buildMongoFilter(params.where);
  const pipeline: readonly Record<string, unknown>[] = [
    {
      $vectorSearch: {
        index: params.partition.searchIndexName,
        path: "embedding",
        queryVector: params.queryEmbedding,
        ...(params.exact ? { exact: true } : { numCandidates: Math.max(params.k * 20, 100) }),
        limit: Math.max(params.k * 20, 100),
        ...(Object.keys(filter).length > 0 ? { filter } : {}),
      },
    },
    {
      $project: {
        _id: 1,
        parent_id: 1,
        text: 1,
        embedding: 1,
        ts: 1,
        source: 1,
        kind: 1,
        project: 1,
        session: 1,
        author: 1,
        role: 1,
        model: 1,
        visibility: 1,
        quality_label: 1,
        title: 1,
        embedding_model: 1,
        embedding_dimensions: 1,
        search_tier: 1,
        chunk_id: 1,
        chunk_index: 1,
        chunk_count: 1,
        normalized_format: 1,
        normalized_estimated_tokens: 1,
        raw_estimated_tokens: 1,
        seed_id: 1,
        member_count: 1,
        char_count: 1,
        source_text_redacted: 1,
        source_ref: 1,
        text_hash_sha256: 1,
        chunk_text_hash_sha256: 1,
        char_start: 1,
        char_end: 1,
        createdAt: 1,
        updatedAt: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  const options = params.exact ? { maxTimeMS: 5000 } : {};
  const rows = await params.collection.aggregate<MongoVectorDocument & { readonly score?: number }>(
    [...pipeline], options,
  ).toArray();
  const rescored = await queryPartitionWithVexxTopK({
    candidates: rows,
    queryEmbedding: params.queryEmbedding,
    k: params.k,
  }).catch((error) => {
    if (VEXX_ENFORCE) throw error;
    return null;
  });
  if (rescored) return rescored;
  if (VEXX_ENFORCE) {
    throw vexxRequiredError(`native_vector_search:${params.partition.collectionName}`);
  }
  return rows.map((doc) => ({ doc, score: typeof doc.score === "number" ? doc.score : Number.NEGATIVE_INFINITY }));
}

export async function queryPartitionWithCosineScan(params: {
  readonly collection: Collection<MongoVectorDocument>;
  readonly queryEmbedding: readonly number[];
  readonly k: number;
  readonly where?: Record<string, unknown>;
}): Promise<ReadonlyArray<{ readonly doc: MongoVectorDocument; readonly score: number }>> {
  const filter = buildMongoFilter(params.where);
  const candidates = await params.collection.find(filter)
    .sort({ ts: -1 }).limit(Math.max(params.k * 50, 1000)).toArray();
  const vexxRows = await queryPartitionWithVexxTopK({
    candidates,
    queryEmbedding: params.queryEmbedding,
    k: params.k,
  }).catch((error) => {
    if (VEXX_ENFORCE) throw error;
    return null;
  });
  if (vexxRows) return vexxRows;
  if (VEXX_ENFORCE) {
    throw vexxRequiredError(`cosine_scan:${params.collection.collectionName}`);
  }
  return candidates
    .map((doc) => ({ doc, score: cosineSimilarity(params.queryEmbedding, doc.embedding ?? []) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score || left.doc._id.localeCompare(right.doc._id))
    .slice(0, Math.max(1, params.k));
}

export async function queryPartitionWithRecovery(
  params: Parameters<typeof queryPartitionWithNativeVectorSearch>[0],
): ReturnType<typeof queryPartitionWithNativeVectorSearch> {
  if (params.partition.searchIndexStatus !== "ready") return queryPartitionWithCosineScan(params);
  const rows = await queryPartitionWithNativeVectorSearch(params).catch(() => null);
  if (rows === null) return queryPartitionWithCosineScan(params);
  if (rows.length > 0) return rows;

  // A successful empty ANN response is not evidence of an empty filtered partition.
  const matching = await params.collection.findOne(buildMongoFilter(params.where), {
    projection: { _id: 1 }, maxTimeMS: 1000,
  });
  if (!matching) return rows;

  // Keep index, model partition, query vector and authorization filters unchanged.
  // Recovery errors must escape: the older bounded recent-document scan cannot
  // establish that an unhealthy populated index has no relevant memories.
  const exactRows = await queryPartitionWithNativeVectorSearch({ ...params, exact: true });
  if (exactRows.length === 0) {
    throw new Error(`vector search returned empty ANN and exact results for nonempty filtered partition ${params.partition.collectionName}`);
  }
  return exactRows;
}

export async function partitionEmbedding(
  params: { readonly getEmbeddingFunctionForModel: (model: string) => IEmbeddingFunction },
  partition: MongoVectorPartitionDocument, queryText: string,
): Promise<readonly number[] | undefined> {
  const [generated] = await params.getEmbeddingFunctionForModel(partition.model).generate([queryText]);
  const embedding = Array.isArray(generated) && generated.length === partition.dimensions ? generated : undefined;
  return embedding;
}

export async function queryMongoVectorsByText(params: {
  readonly mongo: MongoConnection;
  readonly tier: MongoVectorTier;
  readonly q: string;
  readonly k: number;
  readonly where?: Record<string, unknown>;
  readonly getEmbeddingFunctionForModel: (model: string) => IEmbeddingFunction;
}): Promise<RawQueryResult> {
  const queryText = formatEmbeddingQueryText(params.q);
  const partitions = await listMongoVectorPartitions(params.mongo, params.tier);
  if (partitions.length === 0) {
    return emptyResult();
  }

  const cache = new Map<string, readonly number[]>();
  const rows = await partitions.reduce(async (previous, partition) => {
    const existing = await previous;
    const key = `${partition.model}:${partition.dimensions}`;
    const queryEmbedding = cache.get(key) ?? await partitionEmbedding(params, partition, queryText);
    if (queryEmbedding) cache.set(key, queryEmbedding);
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) return existing;
    const partitionRows = await queryPartitionWithRecovery({
      collection: params.mongo.db.collection<MongoVectorDocument>(partition.collectionName),
      partition, queryEmbedding, k: params.k, where: params.where,
    });
    return [...existing, ...partitionRows];
  }, Promise.resolve<ReadonlyArray<{ readonly doc: MongoVectorDocument; readonly score: number }>>([]));

  const sorted = [...rows]
    .sort((left, right) => right.score - left.score || left.doc._id.localeCompare(right.doc._id))
    .slice(0, Math.max(1, params.k));
  const documents = await Promise.all(sorted.map((entry) => hydrateVectorDocumentText(entry.doc)));

  return {
    ids: [sorted.map((entry) => entry.doc._id)],
    documents: [documents],
    metadatas: [sorted.map((entry) => toMetadata(entry.doc))],
    distances: [sorted.map((entry) => Number.isFinite(entry.score) ? 1 - entry.score : null)],
    include: ["documents", "metadatas", "distances"],
  };
}