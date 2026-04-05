import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { OpenPlannerConfig } from "../lib/config.js";
import type { EmbeddingRuntime } from "../lib/embedding-runtime.js";
import { openChroma, type Chroma } from "../lib/chroma.js";

declare module "fastify" {
  interface FastifyInstance {
    chroma: Chroma;
  }
}

export const chromaPlugin = fp<OpenPlannerConfig>(async (app, cfg) => {
  const embeddingRuntime = (app as any).embeddingRuntime as EmbeddingRuntime;
  const getModelForScope = embeddingRuntime.hot.getModel;
  const getEmbeddingFunctionFor = embeddingRuntime.hot.getEmbeddingFunction;
  const getCompactEmbeddingFunction = embeddingRuntime.compact.getEmbeddingFunction;

  const chroma = await openChroma(
    cfg.chromaUrl,
    {
      collectionName: cfg.chromaCollection,
      embeddingFunction: getEmbeddingFunctionFor({}),
      embeddingFunctionFor: getEmbeddingFunctionFor,
      resolveEmbeddingModel: getModelForScope,
    },
    {
      collectionName: cfg.chromaCompactCollection,
      embeddingFunction: getCompactEmbeddingFunction(),
      embeddingFunctionFor: () => getCompactEmbeddingFunction(),
      resolveEmbeddingModel: () => cfg.compactEmbedModel,
    },
  );

  app.decorate("chroma", chroma);
  app.log.info(
    {
      chromaUrl: cfg.chromaUrl,
      collection: chroma.collectionName,
      compactCollection: chroma.compactCollectionName,
      ollamaBaseUrl: cfg.ollamaBaseUrl,
      defaultEmbedModel: cfg.embeddingModels.defaultModel,
      compactEmbedModel: cfg.compactEmbedModel,
      sourceOverrideCount: Object.keys(cfg.embeddingModels.bySource).length,
      kindOverrideCount: Object.keys(cfg.embeddingModels.byKind).length,
      projectOverrideCount: Object.keys(cfg.embeddingModels.byProject).length
    },
    "chroma ready"
  );
});
