import type { SdkMutable, SdkArray } from "./mongo-vector-data.js";
import type { IEmbeddingFunction } from "./embeddings.js";
import { prepareIndexDocument } from "./indexing.js";
import type { MongoConnection } from "./mongodb.js";
import type { MongoVectorTier, MongoVectorEntry } from './mongo-vector-data.js';
import { sourceRedactionMetadata } from './mongo-vector-data.js';
import { replaceMongoVectorEntries } from './mongo-vector-write.js';

export type BatchIndexConfig = SdkMutable<{
  /** Number of documents to process in parallel (default: 16) */
  readonly concurrency?: number;
  /** Number of chunks to embed in a single batch (default: 256) */
  readonly embeddingBatchSize?: number;
  /** Number of documents to write to MongoDB in a single batch (default: 100) */
  readonly mongoBatchSize?: number;
  /** Callback for progress reporting */
  readonly onProgress?: (phase: string, completed: number, total: number) => void;
}>;

type BatchItem = {
  readonly id: string;
  readonly text: string;
  readonly extra?: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
};
type BatchFailure = { readonly id: string; readonly error: string };
type PreparedItem = Omit<BatchItem, "text"> & { readonly prepared: ReturnType<typeof prepareIndexDocument> };
type BatchChunk = Omit<MongoVectorEntry, "embedding">;
type BatchParams = {
  readonly mongo: MongoConnection;
  readonly tier: MongoVectorTier;
  readonly items: readonly BatchItem[];
  readonly embeddingFunction: IEmbeddingFunction;
  readonly config?: BatchIndexConfig;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function prepareBatchItems(items: readonly BatchItem[], recordFailure: (failure: BatchFailure) => void) {
  const prepared = await Promise.all(items.map(async (item): Promise<PreparedItem | null> =>
    Promise.resolve().then(() => ({
      id: item.id, extra: item.extra, metadata: item.metadata,
      prepared: prepareIndexDocument({ parentId: item.id, text: item.text, extra: item.extra }),
    })).catch((error: unknown) => {
      recordFailure({ id: item.id, error: errorMessage(error) });
      return null;
    }),
  ));
  return prepared.filter((item): item is PreparedItem => item !== null);
}

function preparedChunks(item: PreparedItem): readonly BatchChunk[] {
  return item.prepared.chunks.map((chunk) => ({
    id: chunk.id, parentId: item.id, text: chunk.text,
    metadata: {
      ...item.metadata,
      ...sourceRedactionMetadata({
        extra: item.extra, rawText: item.prepared.rawText, chunkText: chunk.text,
        charStart: chunk.charStart, charEnd: chunk.charEnd,
      }),
      chunk_id: chunk.id, chunk_index: chunk.chunkIndex, chunk_count: chunk.chunkCount,
      normalized_format: item.prepared.normalizedFormat,
      normalized_estimated_tokens: item.prepared.normalizedEstimatedTokens,
      raw_estimated_tokens: item.prepared.rawEstimatedTokens,
    },
  }));
}

async function embedBatch(
  batch: readonly BatchChunk[], embeddingFunction: IEmbeddingFunction,
  recordEmbedding: (id: string, vector: readonly number[]) => void,
): Promise<void> {
  await Promise.resolve().then(() => embeddingFunction.generate(batch.map((chunk) => chunk.text))).then((vectors) => {
    if (!Array.isArray(vectors) || vectors.length !== batch.length) {
      throw new Error(`Embedding batch size mismatch: expected ${batch.length}, got ${Array.isArray(vectors) ? vectors.length : 0}`);
    }
    batch.forEach((chunk, index) => {
      const vector = vectors[index];
      if (Array.isArray(vector) && vector.length > 0
        && vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
        recordEmbedding(chunk.id, vector);
      }
    });
  }).catch(() => {
    // Preserve legacy batch semantics: failed chunks have no embedding and are skipped.
    // Preparation and parent-write errors remain the returned failure list.
  });
}

async function embedChunks(
  chunks: readonly BatchChunk[], params: BatchParams, config: BatchIndexConfig,
): Promise<ReadonlyMap<string, readonly number[]>> {
  const size = config.embeddingBatchSize ?? 256;
  const embeddings = new Map<string, readonly number[]>();
  const batches = Array.from({ length: Math.ceil(chunks.length / size) }, (_, index) => index * size);
  await batches.reduce(async (previous, offset) => {
    await previous;
    await embedBatch(chunks.slice(offset, offset + size), params.embeddingFunction, (id, vector) => {
      embeddings.set(id, vector);
    });
    config.onProgress?.("embedding", Math.min(offset + size, chunks.length), chunks.length);
  }, Promise.resolve());
  return embeddings;
}

function groupChunks(chunks: readonly BatchChunk[], embeddings: ReadonlyMap<string, readonly number[]>) {
  return chunks.reduce((groups, chunk) => {
    const embedding = embeddings.get(chunk.id);
    if (embedding) groups.set(chunk.parentId, [
      ...(groups.get(chunk.parentId) ?? []), { ...chunk, embedding: [...embedding] },
    ]);
    return groups;
  }, new Map<string, readonly MongoVectorEntry[]>());
}

async function writeBatchParents(
  params: BatchParams, groups: ReadonlyMap<string, readonly MongoVectorEntry[]>,
  recordFailure: (failure: BatchFailure) => void,
): Promise<number> {
  const config = params.config ?? {};
  const queue = Array.from(groups.keys());
  const completed = new Set<string>();
  const indexed = new Set<string>();
  const processNext = async (): Promise<void> => {
    const parentId = queue.shift();
    if (!parentId) return;
    const entries = groups.get(parentId);
    if (entries?.length) {
      await replaceMongoVectorEntries(params.mongo, params.tier, parentId, entries).then(() => {
        indexed.add(parentId);
      }).catch((error: unknown) => {
        recordFailure({ id: parentId, error: errorMessage(error) });
      });
      completed.add(parentId);
      if (completed.size % (config.mongoBatchSize ?? 100) === 0) {
        config.onProgress?.("indexing", completed.size, groups.size);
      }
    }
    await processNext();
  };
  await Promise.all(Array.from({ length: Math.min(config.concurrency ?? 16, queue.length) }, () => processNext()));
  return indexed.size;
}

export async function batchIndexTextsInMongoVectors(
  params: BatchParams,
): Promise<SdkMutable<{ readonly indexed: number; readonly failed: SdkArray<SdkMutable<BatchFailure>> }>> {
  const config = params.config ?? {};
  const failed = new Map<symbol, BatchFailure>();
  const recordFailure = (failure: BatchFailure) => { failed.set(Symbol(), failure); };
  const prepared = await prepareBatchItems(params.items, recordFailure);
  const chunks = prepared.flatMap(preparedChunks);
  config.onProgress?.("embedding", 0, chunks.length);
  const embeddings = await embedChunks(chunks, params, config);
  const groups = groupChunks(chunks, embeddings);
  config.onProgress?.("indexing", 0, groups.size);
  const indexed = await writeBatchParents(params, groups, recordFailure);
  config.onProgress?.("complete", indexed, params.items.length);
  return { indexed, failed: [...failed.values()] };
}

// Preserve the existing SDK entry point while isolating runtime adapter seams.
export type { MongoVectorEntry, MongoVectorTier } from './mongo-vector-data.js';
export { hydrateVectorDocumentText, buildMongoVectorDeleteFilter } from './mongo-vector-data.js';
export { listMongoVectorPartitions } from './mongo-vector-partitions.js';
export { upsertMongoVectorDocuments, deleteMongoVectorEntriesByFilter, addMongoVectorParentLabel, removeMongoVectorParentLabel, replaceMongoVectorEntries, indexTextInMongoVectors } from './mongo-vector-write.js';
export { queryMongoVectorsByText } from './mongo-vector-query.js';
