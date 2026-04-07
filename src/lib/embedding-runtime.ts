import type { OpenPlannerConfig } from "./config.js";
import { PersistentEmbeddingCache } from "./embedding-cache.js";
import { resolveEmbeddingModel } from "./embedding-models.js";
import { OllamaEmbeddingFunction, ParallelEmbeddingPool } from "./embeddings.js";

export type EmbeddingRuntime = {
  hot: {
    getModel: (scope: { source?: string; kind?: string; project?: string }) => string;
    getEmbeddingFunction: (scope: { source?: string; kind?: string; project?: string }) => OllamaEmbeddingFunction;
    getEmbeddingFunctionForModel: (model: string) => OllamaEmbeddingFunction;
    getParallelPool: (scope: { source?: string; kind?: string; project?: string }) => ParallelEmbeddingPool;
    getParallelPoolForModel: (model: string) => ParallelEmbeddingPool;
  };
  compact: {
    getModel: () => string;
    getEmbeddingFunction: () => OllamaEmbeddingFunction;
    getEmbeddingFunctionForModel: (model: string) => OllamaEmbeddingFunction;
    getParallelPool: () => ParallelEmbeddingPool;
    getParallelPoolForModel: (model: string) => ParallelEmbeddingPool;
  };
};

export function createEmbeddingRuntime(cfg: OpenPlannerConfig): EmbeddingRuntime {
  const embeddingCache = new Map<string, OllamaEmbeddingFunction>();
  const parallelPoolCache = new Map<string, ParallelEmbeddingPool>();
  const persistentCache = new PersistentEmbeddingCache(cfg.ollamaEmbedCachePath);

  const makeEmbeddingFunction = (model: string): OllamaEmbeddingFunction => new OllamaEmbeddingFunction(model, cfg.ollamaBaseUrl, {
    truncate: cfg.ollamaEmbedTruncate,
    numCtx: cfg.ollamaEmbedNumCtx,
    apiKey: cfg.ollamaApiKey,
    cache: persistentCache,
    batchWindowMs: cfg.ollamaEmbedBatchWindowMs,
    maxBatchItems: cfg.ollamaEmbedMaxBatchItems,
    // Allow up to 4 concurrent batches per function for GPU saturation
    maxConcurrentBatches: 4,
  });

  const makeParallelPool = (model: string): ParallelEmbeddingPool => new ParallelEmbeddingPool(model, cfg.ollamaBaseUrl, {
    truncate: cfg.ollamaEmbedTruncate,
    numCtx: cfg.ollamaEmbedNumCtx,
    apiKey: cfg.ollamaApiKey,
    cache: persistentCache,
    batchWindowMs: cfg.ollamaEmbedBatchWindowMs,
    maxBatchItems: cfg.ollamaEmbedMaxBatchItems,
    // 4 workers, each handling multiple concurrent batches
    workerCount: 4,
  });

  const getEmbeddingFunctionForModel = (model: string): OllamaEmbeddingFunction => {
    const cached = embeddingCache.get(model);
    if (cached) return cached;
    const created = makeEmbeddingFunction(model);
    embeddingCache.set(model, created);
    return created;
  };

  const getParallelPoolForModel = (model: string): ParallelEmbeddingPool => {
    const cached = parallelPoolCache.get(model);
    if (cached) return cached;
    const created = makeParallelPool(model);
    parallelPoolCache.set(model, created);
    return created;
  };

  const getHotModel = (scope: { source?: string; kind?: string; project?: string }): string =>
    resolveEmbeddingModel(cfg.embeddingModels, scope);

  return {
    hot: {
      getModel: getHotModel,
      getEmbeddingFunction: (scope) => getEmbeddingFunctionForModel(getHotModel(scope)),
      getEmbeddingFunctionForModel,
      getParallelPool: (scope) => getParallelPoolForModel(getHotModel(scope)),
      getParallelPoolForModel,
    },
    compact: {
      getModel: () => cfg.compactEmbedModel,
      getEmbeddingFunction: () => getEmbeddingFunctionForModel(cfg.compactEmbedModel),
      getEmbeddingFunctionForModel,
      getParallelPool: () => getParallelPoolForModel(cfg.compactEmbedModel),
      getParallelPoolForModel,
    },
  };
}
