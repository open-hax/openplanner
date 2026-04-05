import type { FastifyPluginAsync } from "fastify";

async function checkVectorHealth(app: any): Promise<{ ok: boolean; error?: string; mode: string }> {
  const storageBackend = (app as any).storageBackend ?? "duckdb";
  if (storageBackend === "mongodb") {
    try {
      await app.mongo.db.command({ ping: 1 });
      const [hotIndex, compactIndex] = await Promise.all([
        app.mongo.hotVectors.indexExists("parent_id_1_chunk_index_1"),
        app.mongo.compactVectors.indexExists("parent_id_1"),
      ]);
      if (!hotIndex || !compactIndex) {
        return {
          ok: false,
          mode: "mongodb",
          error: `missing vector indexes: hot=${String(hotIndex)} compact=${String(compactIndex)}`,
        };
      }
      return { ok: true, mode: "mongodb" };
    } catch (error) {
      return { ok: false, mode: "mongodb", error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (!app.chroma?.enabled) {
    return { ok: true, mode: "disabled" };
  }

  try {
    const hotEmbeddingFunction = app.chroma.embeddingFunctionFor?.({}) ?? app.chroma.embeddingFunction;
    const compactEmbeddingFunction = app.chroma.compactEmbeddingFunction ?? hotEmbeddingFunction;
    await Promise.all([
      app.chroma.client.getCollection({
        name: app.chroma.collectionName,
        embeddingFunction: hotEmbeddingFunction as any,
      }),
      app.chroma.client.getCollection({
        name: app.chroma.compactCollectionName,
        embeddingFunction: compactEmbeddingFunction as any,
      }),
    ]);
    return { ok: true, mode: "chroma" };
  } catch (error) {
    return { ok: false, mode: "chroma", error: error instanceof Error ? error.message : String(error) };
  }
}

async function checkEmbeddingHealth(app: any): Promise<{ ok: boolean; enabled: boolean; error?: string }> {
  const storageBackend = (app as any).storageBackend ?? "duckdb";
  const embeddingRuntime = (app as any).embeddingRuntime;

  if (storageBackend === "mongodb") {
    try {
      await embeddingRuntime.hot.getEmbeddingFunction({}).generate(["openplanner healthcheck"]);
      return { ok: true, enabled: true };
    } catch (error) {
      return { ok: false, enabled: true, error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (!app.chroma?.enabled) {
    return { ok: true, enabled: false };
  }

  const embeddingFunction = app.chroma.embeddingFunctionFor?.({}) ?? app.chroma.embeddingFunction;
  if (!embeddingFunction || typeof (embeddingFunction as any).generate !== "function") {
    return { ok: false, enabled: true, error: "embedding function unavailable" };
  }

  try {
    await (embeddingFunction as any).generate(["openplanner healthcheck"]);
    return { ok: true, enabled: true };
  } catch (error) {
    return { ok: false, enabled: true, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getDependencyHealth(app: any) {
  const [vectorStore, embeddings] = await Promise.all([
    checkVectorHealth(app),
    checkEmbeddingHealth(app),
  ]);
  return { vectorStore, embeddings };
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_req, reply) => {
    const storageBackend = (app as any).storageBackend ?? "duckdb";
    const embeddingRuntime = (app as any).embeddingRuntime;
    const dependencyHealth = await getDependencyHealth(app);
    const ok = dependencyHealth.vectorStore.ok && dependencyHealth.embeddings.ok;
    reply.code(ok ? 200 : 503);
    return {
      ok,
      time: new Date().toISOString(),
      ftsEnabled: storageBackend === "mongodb" ? app.mongo.ftsEnabled : app.duck.ftsEnabled,
      vectorCollections: storageBackend === "mongodb"
        ? {
            hot: app.mongo.hotVectors.collectionName,
            compact: app.mongo.compactVectors.collectionName,
          }
        : {
            hot: app.chroma.collectionName,
            compact: app.chroma.compactCollectionName,
          },
      embeddingModels: {
        hot: storageBackend === "mongodb" ? embeddingRuntime.hot.getModel({}) : (app.chroma?.resolveEmbeddingModel?.({}) ?? null),
        compact: storageBackend === "mongodb" ? embeddingRuntime.compact.getModel() : (app.chroma?.resolveCompactEmbeddingModel?.({}) ?? null),
      },
      dependencies: dependencyHealth,
    };
  });
};
