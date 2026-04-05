import crypto from "node:crypto";
import type { Collection, Filter } from "mongodb";
import type { IEmbeddingFunction } from "chromadb";
import { batchPreparedChunks, isContextOverflowError, prepareIndexDocument } from "./indexing.js";
import type { MongoConnection, MongoVectorDocument, MongoVectorPartitionDocument } from "./mongodb.js";

export type MongoVectorTier = "hot" | "compact";

type RawQueryResult = {
  ids: string[][];
  documents: string[][];
  metadatas: Array<Array<Record<string, unknown> | null>>;
  distances: Array<Array<number | null>>;
  include: ["documents", "metadatas", "distances"];
};

export type MongoVectorEntry = {
  id: string;
  parentId: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
};

const VECTOR_SEARCH_INDEX_NAME = "vs_embedding";
const FILTERABLE_PATHS = ["source", "kind", "project", "session", "visibility", "parent_id", "embedding_model"] as const;
const FILTERABLE_PATH_SET = new Set<string>(FILTERABLE_PATHS);
const VEXX_BASE_URL = String(process.env.VEXX_BASE_URL ?? "").trim();
const VEXX_API_KEY = String(process.env.VEXX_API_KEY ?? "").trim();
const VEXX_DEVICE = String(process.env.VEXX_DEVICE ?? "AUTO").trim() || "AUTO";
const VEXX_REQUIRE_ACCEL = /^(1|true|yes|on)$/i.test(String(process.env.VEXX_REQUIRE_ACCEL ?? ""));
const VEXX_MIN_CANDIDATES = (() => {
  const parsed = Number(process.env.VEXX_MIN_CANDIDATES ?? "256");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 256;
})();

function emptyResult(): RawQueryResult {
  return { ids: [[]], documents: [[]], metadatas: [[]], distances: [[]], include: ["documents", "metadatas", "distances"] };
}

function getFlatCollection(mongo: MongoConnection, tier: MongoVectorTier): Collection<MongoVectorDocument> {
  return tier === "compact" ? mongo.compactVectors : mongo.hotVectors;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value ?? new Date().toISOString()));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const next = String(value);
  return next.length > 0 ? next : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeScalarFilterValue(value: unknown): unknown {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  return undefined;
}

function buildMongoFilter(where: Record<string, unknown> | undefined): Filter<MongoVectorDocument> {
  const filter: Filter<MongoVectorDocument> = {};
  if (!where) return filter;

  for (const [key, rawValue] of Object.entries(where)) {
    if (rawValue === undefined || key === "search_tier" || key.startsWith("$") || key.includes(".")) continue;
    if (!FILTERABLE_PATH_SET.has(key)) continue;

    if (typeof rawValue === "object" && rawValue !== null && !Array.isArray(rawValue)) {
      const record = rawValue as Record<string, unknown>;
      if (Array.isArray(record.$in)) {
        (filter as Record<string, unknown>)[key] = { $in: record.$in };
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(record, "$eq")) {
        const normalized = normalizeScalarFilterValue(record.$eq);
        if (normalized !== undefined) {
          (filter as Record<string, unknown>)[key] = normalized;
        }
        continue;
      }
      continue;
    }

    const normalized = normalizeScalarFilterValue(rawValue);
    if (normalized !== undefined) {
      (filter as Record<string, unknown>)[key] = normalized;
    }
  }

  return filter;
}

function dot(left: readonly number[], right: readonly number[]): number {
  let total = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    total += left[index]! * right[index]!;
  }
  return total;
}

function magnitude(input: readonly number[]): number {
  return Math.sqrt(dot(input, input));
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return Number.NEGATIVE_INFINITY;
  const leftMagnitude = magnitude(left);
  const rightMagnitude = magnitude(right);
  if (leftMagnitude === 0 || rightMagnitude === 0) return Number.NEGATIVE_INFINITY;
  return dot(left, right) / (leftMagnitude * rightMagnitude);
}

async function queryPartitionWithVexxTopK(params: {
  candidates: MongoVectorDocument[];
  queryEmbedding: number[];
  k: number;
}): Promise<Array<{ doc: MongoVectorDocument; score: number }> | null> {
  if (!VEXX_BASE_URL) return null;
  const validCandidates = params.candidates.filter(
    (doc) => Array.isArray(doc.embedding) && doc.embedding.length === params.queryEmbedding.length,
  );
  if (validCandidates.length < Math.max(params.k, VEXX_MIN_CANDIDATES)) return null;

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
  });

  if (!response.ok) return null;

  const payload = await response.json() as { matches?: Array<{ id?: string; score?: number }> };
  if (!Array.isArray(payload.matches)) return null;

  const docsById = new Map(validCandidates.map((doc) => [doc._id, doc]));
  return payload.matches
    .map((match) => {
      const id = typeof match.id === "string" ? match.id : "";
      const score = typeof match.score === "number" ? match.score : Number.NEGATIVE_INFINITY;
      const doc = docsById.get(id);
      return doc ? { doc, score } : null;
    })
    .filter((entry): entry is { doc: MongoVectorDocument; score: number } => entry !== null && Number.isFinite(entry.score));
}

function toMetadata(doc: MongoVectorDocument): Record<string, unknown> {
  return {
    ts: doc.ts.toISOString(),
    source: doc.source,
    kind: doc.kind,
    project: doc.project ?? "",
    session: doc.session ?? "",
    author: doc.author ?? "",
    role: doc.role ?? "",
    model: doc.model ?? "",
    visibility: doc.visibility ?? "",
    title: doc.title ?? "",
    embedding_model: doc.embedding_model ?? "",
    embedding_dimensions: doc.embedding_dimensions ?? null,
    search_tier: doc.search_tier,
    parent_id: doc.parent_id,
    chunk_id: doc.chunk_id ?? doc._id,
    chunk_index: doc.chunk_index ?? 0,
    chunk_count: doc.chunk_count ?? 1,
    normalized_format: doc.normalized_format ?? null,
    normalized_estimated_tokens: doc.normalized_estimated_tokens ?? null,
    raw_estimated_tokens: doc.raw_estimated_tokens ?? null,
    seed_id: doc.seed_id ?? null,
    member_count: doc.member_count ?? null,
    char_count: doc.char_count ?? null,
  };
}

function sanitizeModelName(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "model";
}

function hashModelName(model: string): string {
  return crypto.createHash("sha1").update(model).digest("hex").slice(0, 10);
}

function makePartitionCollectionName(baseCollectionName: string, model: string, dimensions: number): string {
  return `${baseCollectionName}__${sanitizeModelName(model)}__d${dimensions}__${hashModelName(model)}`;
}

async function ensurePartitionSupportIndexes(collection: Collection<MongoVectorDocument>): Promise<void> {
  await collection.createIndex({ parent_id: 1, chunk_index: 1 });
  await collection.createIndex({ ts: -1 });
  await collection.createIndex({ source: 1, ts: -1 });
  await collection.createIndex({ kind: 1, ts: -1 });
  await collection.createIndex({ project: 1, ts: -1 });
  await collection.createIndex({ session: 1, ts: -1 });
  await collection.createIndex({ visibility: 1, ts: -1 });
  await collection.createIndex({ embedding_model: 1, embedding_dimensions: 1, ts: -1 });
}

async function ensurePartitionVectorSearchIndex(
  mongo: MongoConnection,
  partition: MongoVectorPartitionDocument,
): Promise<void> {
  const collection = mongo.db.collection<MongoVectorDocument>(partition.collectionName);
  try {
    const existing = await collection.listSearchIndexes(partition.searchIndexName).toArray();
    if (existing.length === 0) {
      await collection.createSearchIndex({
        name: partition.searchIndexName,
        type: "vectorSearch",
        definition: {
          fields: [
            {
              type: "vector",
              path: "embedding",
              numDimensions: partition.dimensions,
              similarity: "cosine",
            },
            ...FILTERABLE_PATHS.map((path) => ({ type: "filter", path })),
          ],
        },
      });
    }

    await mongo.vectorPartitions.updateOne(
      { _id: partition._id },
      {
        $set: {
          searchIndexStatus: "ready",
          lastError: null,
          updatedAt: new Date(),
        },
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await mongo.vectorPartitions.updateOne(
      { _id: partition._id },
      {
        $set: {
          searchIndexStatus: "error",
          lastError: detail,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}

async function ensureVectorPartition(
  mongo: MongoConnection,
  tier: MongoVectorTier,
  model: string,
  dimensions: number,
): Promise<{ partition: MongoVectorPartitionDocument; collection: Collection<MongoVectorDocument> }> {
  const baseCollection = getFlatCollection(mongo, tier);
  const collectionName = makePartitionCollectionName(baseCollection.collectionName, model, dimensions);
  const partitionId = `${tier}:${model}:${dimensions}`;
  const now = new Date();

  await mongo.vectorPartitions.updateOne(
    { _id: partitionId },
    {
      $set: {
        tier,
        model,
        dimensions,
        collectionName,
        searchIndexName: VECTOR_SEARCH_INDEX_NAME,
        updatedAt: now,
      },
      $setOnInsert: {
        searchIndexStatus: "pending",
        lastError: null,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const partition = await mongo.vectorPartitions.findOne({ _id: partitionId });
  if (!partition) {
    throw new Error(`failed to materialize vector partition ${partitionId}`);
  }

  const collection = mongo.db.collection<MongoVectorDocument>(collectionName);
  await ensurePartitionSupportIndexes(collection);
  await ensurePartitionVectorSearchIndex(mongo, partition);
  return { partition: { ...partition, collectionName }, collection };
}

export async function listMongoVectorPartitions(
  mongo: MongoConnection,
  tier: MongoVectorTier,
): Promise<MongoVectorPartitionDocument[]> {
  return mongo.vectorPartitions.find({ tier }).sort({ updatedAt: -1 }).toArray();
}

function toMongoVectorDocument(entry: MongoVectorEntry, tier: MongoVectorTier, now: Date): MongoVectorDocument {
  const ts = asDate(entry.metadata.ts);
  return {
    _id: entry.id,
    parent_id: entry.parentId,
    text: entry.text,
    embedding: entry.embedding,
    ts,
    source: toStringOrNull(entry.metadata.source) ?? "",
    kind: toStringOrNull(entry.metadata.kind) ?? "",
    project: toStringOrNull(entry.metadata.project),
    session: toStringOrNull(entry.metadata.session),
    author: toStringOrNull(entry.metadata.author),
    role: toStringOrNull(entry.metadata.role),
    model: toStringOrNull(entry.metadata.model),
    visibility: toStringOrNull(entry.metadata.visibility),
    title: toStringOrNull(entry.metadata.title),
    embedding_model: toStringOrNull(entry.metadata.embedding_model),
    embedding_dimensions: entry.embedding.length,
    search_tier: tier,
    chunk_id: toStringOrNull(entry.metadata.chunk_id) ?? entry.id,
    chunk_index: toNumberOrNull(entry.metadata.chunk_index),
    chunk_count: toNumberOrNull(entry.metadata.chunk_count),
    normalized_format: toStringOrNull(entry.metadata.normalized_format),
    normalized_estimated_tokens: toNumberOrNull(entry.metadata.normalized_estimated_tokens),
    raw_estimated_tokens: toNumberOrNull(entry.metadata.raw_estimated_tokens),
    seed_id: toStringOrNull(entry.metadata.seed_id),
    member_count: toNumberOrNull(entry.metadata.member_count),
    char_count: toNumberOrNull(entry.metadata.char_count),
    createdAt: now,
    updatedAt: now,
  };
}

export async function upsertMongoVectorDocuments(
  mongo: MongoConnection,
  tier: MongoVectorTier,
  entries: ReadonlyArray<MongoVectorEntry>,
): Promise<void> {
  if (entries.length === 0) return;

  const now = new Date();
  const flatCollection = getFlatCollection(mongo, tier);
  const documents = entries.map((entry) => toMongoVectorDocument(entry, tier, now));

  await flatCollection.bulkWrite(
    documents.map((doc) => {
      const { createdAt, ...docWithoutCreatedAt } = doc;
      return {
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: { ...docWithoutCreatedAt, updatedAt: now },
            $setOnInsert: { createdAt },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );

  const groups = new Map<string, { model: string; dimensions: number; documents: MongoVectorDocument[] }>();
  for (const doc of documents) {
    const model = doc.embedding_model ?? "unknown-model";
    const dimensions = doc.embedding.length;
    const key = `${model}::${dimensions}`;
    const existing = groups.get(key) ?? { model, dimensions, documents: [] };
    existing.documents.push(doc);
    groups.set(key, existing);
  }

  for (const group of groups.values()) {
    const { collection } = await ensureVectorPartition(mongo, tier, group.model, group.dimensions);
    await collection.bulkWrite(
      group.documents.map((doc) => {
        const { createdAt, ...docWithoutCreatedAt } = doc;
        return {
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: { ...docWithoutCreatedAt, updatedAt: now },
              $setOnInsert: { createdAt },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
  }
}

async function deleteMongoVectorEntriesByParent(
  mongo: MongoConnection,
  tier: MongoVectorTier,
  parentId: string,
): Promise<void> {
  await getFlatCollection(mongo, tier).deleteMany({ parent_id: parentId });
  const partitions = await listMongoVectorPartitions(mongo, tier);
  await Promise.all(partitions.map((partition) => mongo.db.collection<MongoVectorDocument>(partition.collectionName).deleteMany({ parent_id: parentId })));
}

export async function deleteMongoVectorEntriesByFilter(
  mongo: MongoConnection,
  tier: MongoVectorTier,
  where: Record<string, unknown>,
): Promise<void> {
  const filter = buildMongoFilter(where);
  await getFlatCollection(mongo, tier).deleteMany(filter);
  const partitions = await listMongoVectorPartitions(mongo, tier);
  await Promise.all(partitions.map((partition) => mongo.db.collection<MongoVectorDocument>(partition.collectionName).deleteMany(filter)));
}

export async function replaceMongoVectorEntries(
  mongo: MongoConnection,
  tier: MongoVectorTier,
  parentId: string,
  entries: ReadonlyArray<MongoVectorEntry>,
): Promise<void> {
  await deleteMongoVectorEntriesByParent(mongo, tier, parentId);
  await upsertMongoVectorDocuments(mongo, tier, entries);
}

export async function indexTextInMongoVectors(params: {
  mongo: MongoConnection;
  tier: MongoVectorTier;
  parentId: string;
  text: string;
  extra?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  embeddingFunction: IEmbeddingFunction;
}): Promise<void> {
  const tryIndex = async (forceChunking: boolean): Promise<void> => {
    const prepared = prepareIndexDocument({
      parentId: params.parentId,
      text: params.text,
      extra: params.extra,
      forceChunking,
    });

    const entries: MongoVectorEntry[] = [];

    for (const batch of batchPreparedChunks(prepared.chunks)) {
      const texts = batch.map((chunk) => chunk.text);
      const embeddings = await params.embeddingFunction.generate(texts);
      batch.forEach((chunk, index) => {
        entries.push({
          id: chunk.id,
          parentId: params.parentId,
          text: chunk.text,
          embedding: embeddings[index] ?? [],
          metadata: {
            ...params.metadata,
            chunk_id: chunk.id,
            chunk_index: chunk.chunkIndex,
            chunk_count: chunk.chunkCount,
            normalized_format: prepared.normalizedFormat,
            normalized_estimated_tokens: prepared.normalizedEstimatedTokens,
            raw_estimated_tokens: prepared.rawEstimatedTokens,
          },
        });
      });
    }

    await replaceMongoVectorEntries(params.mongo, params.tier, params.parentId, entries);
  };

  try {
    await tryIndex(false);
  } catch (error) {
    if (!isContextOverflowError(error)) throw error;
    await tryIndex(true);
  }
}

async function queryPartitionWithNativeVectorSearch(params: {
  collection: Collection<MongoVectorDocument>;
  partition: MongoVectorPartitionDocument;
  queryEmbedding: number[];
  k: number;
  where?: Record<string, unknown>;
}): Promise<Array<{ doc: MongoVectorDocument; score: number }>> {
  const filter = buildMongoFilter(params.where);
  const pipeline: Record<string, unknown>[] = [
    {
      $vectorSearch: {
        index: params.partition.searchIndexName,
        path: "embedding",
        queryVector: params.queryEmbedding,
        numCandidates: Math.max(params.k * 20, 100),
        limit: Math.max(1, params.k),
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
        createdAt: 1,
        updatedAt: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  const rows = await params.collection.aggregate(pipeline).toArray() as Array<MongoVectorDocument & { score?: number }>;
  return rows.map((doc) => ({ doc, score: typeof doc.score === "number" ? doc.score : Number.NEGATIVE_INFINITY }));
}

async function queryPartitionWithCosineScan(params: {
  collection: Collection<MongoVectorDocument>;
  queryEmbedding: number[];
  k: number;
  where?: Record<string, unknown>;
}): Promise<Array<{ doc: MongoVectorDocument; score: number }>> {
  const filter = buildMongoFilter(params.where);
  const candidates = await params.collection.find(filter).sort({ ts: -1 }).limit(Math.max(params.k * 50, 1000)).toArray();
  const vexxRows = await queryPartitionWithVexxTopK({
    candidates,
    queryEmbedding: params.queryEmbedding,
    k: params.k,
  }).catch(() => null);
  if (vexxRows) return vexxRows;
  return candidates
    .map((doc) => ({ doc, score: cosineSimilarity(params.queryEmbedding, doc.embedding ?? []) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score || left.doc._id.localeCompare(right.doc._id))
    .slice(0, Math.max(1, params.k));
}

export async function queryMongoVectorsByText(params: {
  mongo: MongoConnection;
  tier: MongoVectorTier;
  q: string;
  k: number;
  where?: Record<string, unknown>;
  getEmbeddingFunctionForModel: (model: string) => IEmbeddingFunction;
}): Promise<RawQueryResult> {
  const partitions = await listMongoVectorPartitions(params.mongo, params.tier);
  if (partitions.length === 0) {
    return emptyResult();
  }

  const rows: Array<{ doc: MongoVectorDocument; score: number }> = [];
  const queryEmbeddingsByModel = new Map<string, number[]>();

  for (const partition of partitions) {
    const collection = params.mongo.db.collection<MongoVectorDocument>(partition.collectionName);
    let queryEmbedding = queryEmbeddingsByModel.get(partition.model);
    if (!queryEmbedding) {
      const embeddingFunction = params.getEmbeddingFunctionForModel(partition.model);
      const [generatedEmbedding] = await embeddingFunction.generate([params.q]);
      queryEmbedding = Array.isArray(generatedEmbedding) ? generatedEmbedding : undefined;
      if (queryEmbedding) queryEmbeddingsByModel.set(partition.model, queryEmbedding);
    }
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) continue;

    let partitionRows: Array<{ doc: MongoVectorDocument; score: number }>;
    if (partition.searchIndexStatus === "ready") {
      try {
        partitionRows = await queryPartitionWithNativeVectorSearch({
          collection,
          partition,
          queryEmbedding,
          k: params.k,
          where: params.where,
        });
      } catch {
        partitionRows = await queryPartitionWithCosineScan({
          collection,
          queryEmbedding,
          k: params.k,
          where: params.where,
        });
      }
    } else {
      partitionRows = await queryPartitionWithCosineScan({
        collection,
        queryEmbedding,
        k: params.k,
        where: params.where,
      });
    }

    rows.push(...partitionRows);
  }

  const sorted = rows
    .sort((left, right) => right.score - left.score || left.doc._id.localeCompare(right.doc._id))
    .slice(0, Math.max(1, params.k));

  return {
    ids: [sorted.map((entry) => entry.doc._id)],
    documents: [sorted.map((entry) => entry.doc.text)],
    metadatas: [sorted.map((entry) => toMetadata(entry.doc))],
    distances: [sorted.map((entry) => Number.isFinite(entry.score) ? 1 - entry.score : null)],
    include: ["documents", "metadatas", "distances"],
  };
}

export function buildMongoVectorDeleteFilter(where: Record<string, unknown>): Filter<MongoVectorDocument> {
  return buildMongoFilter(where);
}
