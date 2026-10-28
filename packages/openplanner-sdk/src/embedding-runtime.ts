import type { SdkMutable } from "./types.js";

import type { OpenPlannerConfig } from "./config.js";
import { PersistentEmbeddingCache } from "./embedding-cache.js";
import { resolveEmbeddingModel } from "./embedding-models.js";
import { EmbedProviderFunction, ParallelEmbeddingPool } from "./embeddings.js";

type RuntimeScope = SdkMutable<{
  readonly source?: string;
  readonly kind?: string;
  readonly project?: string;
}>;

export type EmbeddingRuntime = SdkMutable<{
  readonly hot: SdkMutable<{
    readonly getModel: (scope: RuntimeScope) => string;
    readonly getEmbeddingFunction: (scope: RuntimeScope) => EmbedProviderFunction;
    readonly getEmbeddingFunctionForModel: (model: string) => EmbedProviderFunction;
    readonly getBackgroundEmbeddingFunction: (scope: RuntimeScope) => EmbedProviderFunction;
    readonly getBackgroundEmbeddingFunctionForModel: (model: string) => EmbedProviderFunction;
    readonly getParallelPool: (scope: RuntimeScope) => ParallelEmbeddingPool;
    readonly getParallelPoolForModel: (model: string) => ParallelEmbeddingPool;
  }>;
  readonly compact: SdkMutable<{
    readonly getModel: () => string;
    readonly getEmbeddingFunction: () => EmbedProviderFunction;
    readonly getEmbeddingFunctionForModel: (model: string) => EmbedProviderFunction;
    readonly getBackgroundEmbeddingFunction: () => EmbedProviderFunction;
    readonly getBackgroundEmbeddingFunctionForModel: (model: string) => EmbedProviderFunction;
    readonly getParallelPool: () => ParallelEmbeddingPool;
    readonly getParallelPoolForModel: (model: string) => ParallelEmbeddingPool;
  }>;
}>;

export function createEmbeddingRuntime(cfg: OpenPlannerConfig): EmbeddingRuntime {
  const interactiveCache = new Map<string, EmbedProviderFunction>();
  const backgroundCache = new Map<string, EmbedProviderFunction>();
  const parallelPoolCache = new Map<string, ParallelEmbeddingPool>();
  const persistentCache = new PersistentEmbeddingCache(cfg.embedProviderCachePath);

  const makeEmbeddingFunction = (
    model: string, opts?: { readonly maxConcurrentBatches?: number },
  ): EmbedProviderFunction => new EmbedProviderFunction(model, cfg.embedProviderBaseUrl, {
    apiKey: cfg.embedProviderApiKey,
    cache: persistentCache,
    batchWindowMs: cfg.embedProviderBatchWindowMs,
    maxBatchItems: cfg.embedProviderMaxBatchItems,
    maxConcurrentBatches: opts?.maxConcurrentBatches ?? 1,
  });

  const makeParallelPool = (model: string): ParallelEmbeddingPool => new ParallelEmbeddingPool(
    model, cfg.embedProviderBaseUrl, {
      apiKey: cfg.embedProviderApiKey,
      cache: persistentCache,
      batchWindowMs: cfg.embedProviderBatchWindowMs,
      maxBatchItems: cfg.embedProviderMaxBatchItems,
      workerCount: 4,
    },
  );

  const getEmbeddingFunctionForModel = (model: string): EmbedProviderFunction => {
    const cached = interactiveCache.get(model);
    if (cached) return cached;
    const created = makeEmbeddingFunction(model, { maxConcurrentBatches: 2 });
    interactiveCache.set(model, created);
    return created;
  };

  const getBackgroundEmbeddingFunctionForModel = (model: string): EmbedProviderFunction => {
    const cached = backgroundCache.get(model);
    if (cached) return cached;
    const created = makeEmbeddingFunction(model, { maxConcurrentBatches: 6 });
    backgroundCache.set(model, created);
    return created;
  };

  const getParallelPoolForModel = (model: string): ParallelEmbeddingPool => {
    const cached = parallelPoolCache.get(model);
    if (cached) return cached;
    const created = makeParallelPool(model);
    parallelPoolCache.set(model, created);
    return created;
  };

  const getHotModel = (scope: Readonly<RuntimeScope>): string =>
    resolveEmbeddingModel(cfg.embeddingModels, scope);

  return {
    hot: {
      getModel: getHotModel,
      getEmbeddingFunction: (scope) => getEmbeddingFunctionForModel(getHotModel(scope)),
      getEmbeddingFunctionForModel,
      getBackgroundEmbeddingFunction: (scope) => getBackgroundEmbeddingFunctionForModel(getHotModel(scope)),
      getBackgroundEmbeddingFunctionForModel,
      getParallelPool: (scope) => getParallelPoolForModel(getHotModel(scope)),
      getParallelPoolForModel,
    },
    compact: {
      getModel: () => cfg.compactEmbedModel,
      getEmbeddingFunction: () => getEmbeddingFunctionForModel(cfg.compactEmbedModel),
      getEmbeddingFunctionForModel,
      getBackgroundEmbeddingFunction: () => getBackgroundEmbeddingFunctionForModel(cfg.compactEmbedModel),
      getBackgroundEmbeddingFunctionForModel,
      getParallelPool: () => getParallelPoolForModel(cfg.compactEmbedModel),
      getParallelPoolForModel,
    },
  };
}
