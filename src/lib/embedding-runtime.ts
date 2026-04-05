import type { OpenPlannerConfig } from "./config.js";
import { resolveEmbeddingModel } from "./embedding-models.js";
import { OllamaEmbeddingFunction } from "./embeddings.js";

export type EmbeddingRuntime = {
  hot: {
    getModel: (scope: { source?: string; kind?: string; project?: string }) => string;
    getEmbeddingFunction: (scope: { source?: string; kind?: string; project?: string }) => OllamaEmbeddingFunction;
    getEmbeddingFunctionForModel: (model: string) => OllamaEmbeddingFunction;
  };
  compact: {
    getModel: () => string;
    getEmbeddingFunction: () => OllamaEmbeddingFunction;
    getEmbeddingFunctionForModel: (model: string) => OllamaEmbeddingFunction;
  };
};

export function createEmbeddingRuntime(cfg: OpenPlannerConfig): EmbeddingRuntime {
  const embeddingCache = new Map<string, OllamaEmbeddingFunction>();

  const makeEmbeddingFunction = (model: string): OllamaEmbeddingFunction => new OllamaEmbeddingFunction(model, cfg.ollamaBaseUrl, {
    truncate: cfg.ollamaEmbedTruncate,
    numCtx: cfg.ollamaEmbedNumCtx,
    apiKey: cfg.ollamaApiKey,
  });

  const getEmbeddingFunctionForModel = (model: string): OllamaEmbeddingFunction => {
    const cached = embeddingCache.get(model);
    if (cached) return cached;
    const created = makeEmbeddingFunction(model);
    embeddingCache.set(model, created);
    return created;
  };

  const getHotModel = (scope: { source?: string; kind?: string; project?: string }): string =>
    resolveEmbeddingModel(cfg.embeddingModels, scope);

  return {
    hot: {
      getModel: getHotModel,
      getEmbeddingFunction: (scope) => getEmbeddingFunctionForModel(getHotModel(scope)),
      getEmbeddingFunctionForModel,
    },
    compact: {
      getModel: () => cfg.compactEmbedModel,
      getEmbeddingFunction: () => getEmbeddingFunctionForModel(cfg.compactEmbedModel),
      getEmbeddingFunctionForModel,
    },
  };
}
