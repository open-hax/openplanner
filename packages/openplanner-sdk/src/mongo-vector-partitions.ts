import type { SdkArray } from "./mongo-vector-data.js";
import crypto from "node:crypto";
import type { Collection } from "mongodb";
import type { MongoConnection, MongoVectorDocument, MongoVectorPartitionDocument } from "./mongodb.js";
import type { MongoVectorTier } from './mongo-vector-data.js';
import { FILTERABLE_PATHS, getFlatCollection, parsePositiveIntEnv } from './mongo-vector-data.js';

export const VECTOR_SEARCH_INDEX_NAME = "vs_embedding";

export async function ensureVectorTtlIndex(
  collection: Collection<MongoVectorDocument>, tier: MongoVectorTier,
): Promise<void> {
  const ttlSeconds = tier === "hot"
    ? parsePositiveIntEnv("MONGODB_EVENTS_TTL_SECONDS")
    : parsePositiveIntEnv("MONGODB_COMPACTED_TTL_SECONDS");
  if (ttlSeconds <= 0) return;

  const name = tier === "hot" ? "hot_vectors_ttl" : "compact_vectors_ttl";
  const existing = (await collection.indexes()).find((index) => index.name === name);
  if (
    existing
    && (
      existing.expireAfterSeconds !== 0
      || JSON.stringify(existing.partialFilterExpression ?? {}) !== JSON.stringify({})
    )
  ) {
    await collection.dropIndex(name);
  }

  await collection.createIndex(
    { expiresAt: 1 },
    {
      expireAfterSeconds: 0,
      name,
      background: true,
    },
  );
}

export function sanitizeModelName(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "model";
}

export function hashModelName(model: string): string {
  return crypto.createHash("sha1").update(model).digest("hex").slice(0, 10);
}

export function makePartitionCollectionName(baseCollectionName: string, model: string, dimensions: number): string {
  return `${baseCollectionName}__${sanitizeModelName(model)}__d${dimensions}__${hashModelName(model)}`;
}

export function makePartitionKey(model: string, dimensions: number): string {
  return `${model}::${dimensions}`;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollSearchIndex(params: {
  readonly collection: Collection<MongoVectorDocument>;
  readonly indexName: string;
  readonly deadline: number;
  readonly pollMs: number;
}, lastState = "missing"): Promise<void> {
  if (Date.now() >= params.deadline) {
    throw new Error(`timed out waiting for vector search index ${params.indexName} to become queryable (${lastState})`);
  }
  const [index] = await params.collection.listSearchIndexes(params.indexName).toArray() as
    ReadonlyArray<Record<string, unknown>>;
  const status = index ? String(index.status ?? "UNKNOWN").toUpperCase() : "missing";
  const state = index ? `${status} queryable=${String(index.queryable === true)}` : lastState;
  if (status === "READY" && index?.queryable === true) return;
  if (status === "FAILED" || status === "DOES_NOT_EXIST") {
    throw new Error(`vector search index ${params.indexName} failed: ${state}`);
  }
  await sleep(params.pollMs);
  return pollSearchIndex(params, state);
}

export async function waitForQueryableSearchIndex(
  collection: Collection<MongoVectorDocument>, indexName: string, timeoutMs = 60_000, pollMs = 2_000,
): Promise<void> {
  return pollSearchIndex({ collection, indexName, deadline: Date.now() + timeoutMs, pollMs });
}

export async function ensurePartitionSupportIndexes(
  collection: Collection<MongoVectorDocument>, tier: MongoVectorTier,
): Promise<void> {
  await collection.createIndex({ parent_id: 1, chunk_index: 1 });
  await collection.createIndex({ ts: -1 });
  await collection.createIndex({ source: 1, ts: -1 });
  await collection.createIndex({ kind: 1, ts: -1 });
  await collection.createIndex({ project: 1, ts: -1 });
  await collection.createIndex({ session: 1, ts: -1 });
  await collection.createIndex({ visibility: 1, ts: -1 });
  await collection.createIndex({ quality_label: 1, ts: -1 });
  await collection.createIndex({ labels: 1, ts: -1 });
  await collection.createIndex({ embedding_model: 1, embedding_dimensions: 1, ts: -1 });
  await collection.createIndex({ schema_version: 1, ts: -1 });
  await ensureVectorTtlIndex(collection, tier);
}

export async function ensurePartitionVectorSearchIndex(
  mongo: MongoConnection,
  partition: MongoVectorPartitionDocument,
): Promise<void> {
  const collection = mongo.db.collection<MongoVectorDocument>(partition.collectionName);
  await (async () => {
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

    await waitForQueryableSearchIndex(collection, partition.searchIndexName);

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
  })().catch(async (error) => {
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
  });
}

export async function ensureVectorPartition(
  mongo: MongoConnection,
  tier: MongoVectorTier,
  model: string,
  dimensions: number,
): Promise<{ readonly partition: MongoVectorPartitionDocument; readonly collection: Collection<MongoVectorDocument> }> {
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
  await ensurePartitionSupportIndexes(collection, tier);
  await ensurePartitionVectorSearchIndex(mongo, partition);
  return { partition: { ...partition, collectionName }, collection };
}

export async function listMongoVectorPartitions(
  mongo: MongoConnection,
  tier: MongoVectorTier,
): Promise<SdkArray<MongoVectorPartitionDocument>> {
  return mongo.vectorPartitions.find({ tier }).sort({ updatedAt: -1 }).toArray();
}