import type { ClientSession, Collection, Filter } from "mongodb";
import type { IEmbeddingFunction } from "./embeddings.js";
import { batchPreparedChunks, isContextOverflowError, prepareIndexDocument } from "./indexing.js";
import type { MongoConnection, MongoVectorDocument } from "./mongodb.js";
import type { MongoVectorTier, MongoVectorEntry } from './mongo-vector-data.js';
import { getFlatCollection, parsePositiveIntEnv, ttlExpiryFromNow, sourceRedactionMetadata, buildMongoFilter, toMongoVectorDocument } from './mongo-vector-data.js';
import { makePartitionCollectionName, makePartitionKey, ensureVectorPartition, listMongoVectorPartitions } from './mongo-vector-partitions.js';

export function isTransactionUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Transaction numbers are only allowed|transactions are not supported|replica set member|mongos/i.test(message);
}

export async function withMongoTransaction<T>(
  mongo: MongoConnection, work: (session: ClientSession | undefined) => Promise<T>,
): Promise<T> {
  const session = mongo.client.startSession();
  return Promise.resolve().then(() => session.withTransaction(async () => work(session))).catch((error: unknown) => {
    if (isTransactionUnsupported(error)) return work(undefined);
    throw error;
  }).finally(() => session.endSession());
}

export async function bulkWriteVectorDocuments(
  collection: Collection<MongoVectorDocument>,
  documents: ReadonlyArray<MongoVectorDocument>,
  now: Date,
  session?: ClientSession,
): Promise<void> {
  if (documents.length === 0) return;
  await collection.bulkWrite(
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
    { ordered: false, ...(session ? { session } : {}) },
  );
}

export async function deletePartitionDocuments(
  mongo: MongoConnection, partitionCollectionNames: ReadonlyArray<string>,
  filter: Filter<MongoVectorDocument>, session?: ClientSession,
): Promise<void> {
  const remove = (name: string) => mongo.db.collection<MongoVectorDocument>(name)
    .deleteMany(filter, session ? { session } : undefined);
  if (session) {
    await partitionCollectionNames.reduce(async (previous, name) => {
      await previous;
      await remove(name);
    }, Promise.resolve());
    return;
  }
  await Promise.all(partitionCollectionNames.map(remove));
}

export type VectorGroup = {
  readonly model: string;
  readonly dimensions: number;
  readonly documents: readonly MongoVectorDocument[];
};

export function groupVectorDocuments(documents: readonly MongoVectorDocument[]): ReadonlyMap<string, VectorGroup> {
  return documents.reduce((groups, doc) => {
    const model = doc.embedding_model ?? "unknown-model";
    const dimensions = doc.embedding.length;
    const key = makePartitionKey(model, dimensions);
    const previous = groups.get(key)?.documents ?? [];
    groups.set(key, { model, dimensions, documents: [...previous, doc] });
    return groups;
  }, new Map<string, VectorGroup>());
}

export async function materializePartitions(
  mongo: MongoConnection, tier: MongoVectorTier, groups: ReadonlyMap<string, VectorGroup>,
): Promise<ReadonlyMap<string, Collection<MongoVectorDocument>>> {
  const collections = new Map<string, Collection<MongoVectorDocument>>();
  await [...groups].reduce(async (previous, [key, group]) => {
    await previous;
    const { collection } = await ensureVectorPartition(mongo, tier, group.model, group.dimensions);
    collections.set(key, collection);
  }, Promise.resolve());
  return collections;
}

export async function writePartitionGroups(params: {
  readonly groups: ReadonlyMap<string, VectorGroup>;
  readonly partitionCollections: ReadonlyMap<string, Collection<MongoVectorDocument>>;
  readonly now: Date;
  readonly session?: ClientSession;
}): Promise<void> {
  await [...params.groups].reduce(async (previous, [key, group]) => {
    await previous;
    const collection = params.partitionCollections.get(key);
    if (collection) await bulkWriteVectorDocuments(collection, group.documents, params.now, params.session);
  }, Promise.resolve());
}

export type ExistingVector = {
  readonly _id: string;
  readonly embedding_model?: string | null;
  readonly embedding_dimensions?: number | null;
};

export async function removeStalePartitions(params: {
  readonly mongo: MongoConnection;
  readonly flatCollection: Collection<MongoVectorDocument>;
  readonly documents: readonly MongoVectorDocument[];
  readonly existingDocs: readonly ExistingVector[];
  readonly session?: ClientSession;
}): Promise<void> {
  const next = new Map(params.documents.map((doc) => [
    doc._id, makePartitionKey(doc.embedding_model ?? "unknown-model", doc.embedding.length),
  ]));
  const stale = params.existingDocs.reduce((groups, existing) => {
    const model = existing.embedding_model ?? "unknown-model";
    const dimensions = Number(existing.embedding_dimensions ?? 0);
    if (!Number.isFinite(dimensions) || dimensions <= 0) return groups;
    const key = makePartitionKey(model, dimensions);
    if (key === next.get(existing._id)) return groups;
    const name = makePartitionCollectionName(params.flatCollection.collectionName, model, dimensions);
    groups.set(name, [...(groups.get(name) ?? []), existing._id]);
    return groups;
  }, new Map<string, readonly string[]>());
  await [...stale].reduce(async (previous, [name, ids]) => {
    await previous;
    await params.mongo.db.collection<MongoVectorDocument>(name).deleteMany(
      { _id: { $in: ids } }, params.session ? { session: params.session } : undefined,
    );
  }, Promise.resolve());
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

  const groups = groupVectorDocuments(documents);
  const partitionCollections = await materializePartitions(mongo, tier, groups);

  await withMongoTransaction(mongo, async (session) => {
    const existingDocs = await flatCollection.find(
      { _id: { $in: documents.map((doc) => doc._id) } },
      session ? { session } : undefined,
    ).project<ExistingVector>({
      _id: 1,
      embedding_model: 1,
      embedding_dimensions: 1,
    }).toArray();

    await removeStalePartitions({ mongo, flatCollection, documents, existingDocs, session });

    await bulkWriteVectorDocuments(flatCollection, documents, now, session);
    await writePartitionGroups({ groups, partitionCollections, now, session });
  });
}

export async function deleteMongoVectorEntriesByParent(
  mongo: MongoConnection,
  tier: MongoVectorTier,
  parentId: string,
  session?: ClientSession,
): Promise<void> {
  await getFlatCollection(mongo, tier).deleteMany({ parent_id: parentId }, session ? { session } : undefined);
  const partitions = await listMongoVectorPartitions(mongo, tier);
  await deletePartitionDocuments(
    mongo,
    partitions.map((partition) => partition.collectionName),
    { parent_id: parentId },
    session,
  );
}

export async function deleteMongoVectorEntriesByFilter(
  mongo: MongoConnection,
  tier: MongoVectorTier,
  where: Record<string, unknown>,
): Promise<void> {
  const filter = buildMongoFilter(where);
  if (Object.keys(filter).length === 0) {
    throw new Error("deleteMongoVectorEntriesByFilter requires at least one supported filter field");
  }
  const partitions = await listMongoVectorPartitions(mongo, tier);
  await withMongoTransaction(mongo, async (session) => {
    await getFlatCollection(mongo, tier).deleteMany(filter, session ? { session } : undefined);
    await deletePartitionDocuments(
      mongo,
      partitions.map((partition) => partition.collectionName),
      filter,
      session,
    );
  });
}

export async function updatePartitionVectorLabels(
  mongo: MongoConnection,
  tier: MongoVectorTier,
  parentId: string,
  update: Record<string, unknown> | readonly Record<string, unknown>[],
): Promise<void> {
  const partitions = await listMongoVectorPartitions(mongo, tier);
  await Promise.all(partitions.map((partition) => (
    mongo.db.collection<MongoVectorDocument>(partition.collectionName).updateMany({ parent_id: parentId }, update)
  )));
}

export async function addMongoVectorParentLabel(
  mongo: MongoConnection,
  parentId: string,
  label: string,
): Promise<void> {
  const normalized = label.trim();
  if (!normalized) return;
  const update = [
    {
      $set: {
        labels: {
          $setUnion: [
            { $cond: [{ $isArray: "$labels" }, "$labels", []] },
            [normalized],
          ],
        },
        expiresAt: "$$REMOVE",
        updatedAt: new Date(),
      },
    },
  ];
  await Promise.all([
    mongo.hotVectors.updateMany({ parent_id: parentId }, update),
    mongo.compactVectors.updateMany({ parent_id: parentId }, update),
    updatePartitionVectorLabels(mongo, "hot", parentId, update),
    updatePartitionVectorLabels(mongo, "compact", parentId, update),
  ]);
}

export async function removeMongoVectorParentLabel(
  mongo: MongoConnection,
  parentId: string,
  label: string,
): Promise<void> {
  const normalized = label.trim();
  if (!normalized) return;
  const updateForTier = (tier: MongoVectorTier) => {
    const ttlSeconds = tier === "hot"
      ? parsePositiveIntEnv("MONGODB_EVENTS_TTL_SECONDS")
      : parsePositiveIntEnv("MONGODB_COMPACTED_TTL_SECONDS");
    const expiresAt = ttlExpiryFromNow(ttlSeconds) ?? null;
    return [
      {
        $set: {
          labels: {
            $filter: {
              input: { $cond: [{ $isArray: "$labels" }, "$labels", []] },
              as: "existingLabel",
              cond: { $ne: ["$$existingLabel", normalized] },
            },
          },
          updatedAt: new Date(),
        },
      },
      {
        $set: {
          expiresAt: {
            $cond: [
              { $gt: [{ $size: "$labels" }, 0] },
              "$$REMOVE",
              expiresAt,
            ],
          },
        },
      },
    ];
  };
  const hotUpdate = updateForTier("hot");
  const compactUpdate = updateForTier("compact");
  await Promise.all([
    mongo.hotVectors.updateMany({ parent_id: parentId }, hotUpdate),
    mongo.compactVectors.updateMany({ parent_id: parentId }, compactUpdate),
    updatePartitionVectorLabels(mongo, "hot", parentId, hotUpdate),
    updatePartitionVectorLabels(mongo, "compact", parentId, compactUpdate),
  ]);
}

export async function replaceMongoVectorEntries(
  mongo: MongoConnection,
  tier: MongoVectorTier,
  parentId: string,
  entries: ReadonlyArray<MongoVectorEntry>,
): Promise<void> {
  const now = new Date();
  const documents = entries.map((entry) => toMongoVectorDocument(entry, tier, now));
  const groups = groupVectorDocuments(documents);
  const partitionCollections = await materializePartitions(mongo, tier, groups);

  await withMongoTransaction(mongo, async (session) => {
    await deleteMongoVectorEntriesByParent(mongo, tier, parentId, session);
    await bulkWriteVectorDocuments(getFlatCollection(mongo, tier), documents, now, session);
    await writePartitionGroups({ groups, partitionCollections, now, session });
  });
}

export async function indexTextInMongoVectors(params: {
  readonly mongo: MongoConnection;
  readonly tier: MongoVectorTier;
  readonly parentId: string;
  readonly text: string;
  readonly extra?: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly embeddingFunction: IEmbeddingFunction;
}): Promise<void> {
  const tryIndex = async (forceChunking: boolean): Promise<void> => {
    const prepared = prepareIndexDocument({
      parentId: params.parentId,
      text: params.text,
      extra: params.extra,
      forceChunking,
    });

    const entries = await batchPreparedChunks(prepared.chunks).reduce(async (previous, batch) => {
      const existing = await previous;
      const texts = batch.map((chunk) => chunk.text);
      const embeddings = await params.embeddingFunction.generate(texts);
      if (!Array.isArray(embeddings) || embeddings.length !== batch.length) {
        throw new Error(`embedding batch size mismatch: expected ${batch.length}, got ${Array.isArray(embeddings) ? embeddings.length : 0}`);
      }
      const dimensions = Array.isArray(embeddings[0]) ? embeddings[0].length : 0;
      if (dimensions <= 0) {
        throw new Error(`embedding function returned an empty vector batch for ${params.parentId}`);
      }
      const next = batch.map((chunk, index): MongoVectorEntry => {
        const embedding = embeddings[index];
        if (!Array.isArray(embedding) || embedding.length !== dimensions || embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
          throw new Error(`invalid embedding vector for ${chunk.id} at batch index ${index}`);
        }
        return {
          id: chunk.id,
          parentId: params.parentId,
          text: chunk.text,
          embedding,
          metadata: {
            ...params.metadata,
            ...sourceRedactionMetadata({
              extra: params.extra,
              rawText: prepared.rawText,
              chunkText: chunk.text,
              charStart: chunk.charStart,
              charEnd: chunk.charEnd,
            }),
            chunk_id: chunk.id,
            chunk_index: chunk.chunkIndex,
            chunk_count: chunk.chunkCount,
            normalized_format: prepared.normalizedFormat,
            normalized_estimated_tokens: prepared.normalizedEstimatedTokens,
            raw_estimated_tokens: prepared.rawEstimatedTokens,
          },
        };
      });
      return [...existing, ...next];
    }, Promise.resolve<readonly MongoVectorEntry[]>([]));

    await replaceMongoVectorEntries(params.mongo, params.tier, params.parentId, entries);
  };

  await tryIndex(false).catch(async (error: unknown) => {
    if (!isContextOverflowError(error)) throw error;
    await tryIndex(true);
  });
}