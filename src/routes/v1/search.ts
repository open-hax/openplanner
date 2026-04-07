import type { FastifyPluginAsync } from "fastify";
import { ftsSearch, ilikeSearch } from "../../lib/mongodb.js";
import { queryMongoVectorsByText } from "../../lib/mongo-vectors.js";
import type { FtsSearchRequest, VectorSearchRequest } from "../../lib/types.js";
import { extractTieredVectorHits, mergeTieredVectorHits } from "../../lib/vector-search.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: FtsSearchRequest }>("/search/fts", async (req, reply) => {
    const body = req.body;
    const q = body.q;
    const limit = body.limit ?? 20;
    if (!q || typeof q !== "string") return reply.status(400).send({ error: "q is required" });

    const lim = Math.max(1, Math.min(200, Number(limit)));
    const tier = body.tier ?? "both";

    // MongoDB full-text search
    try {
      const results = await ftsSearch(app.mongo.events, q, {
        limit: lim,
        source: body.source,
        kind: body.kind,
        project: body.project,
        session: body.session,
        visibility: body.visibility,
      });
      return { ok: true, ftsEnabled: true, count: results.length, rows: results, tier, storageBackend: "mongodb" };
    } catch {
      // Fallback to $regex search if text search fails
      const results = await ilikeSearch(app.mongo.events, q, {
        limit: lim,
        source: body.source,
        kind: body.kind,
        project: body.project,
        session: body.session,
        visibility: body.visibility,
      });
      return { ok: true, ftsEnabled: false, count: results.length, rows: results, tier, storageBackend: "mongodb" };
    }
  });

  app.post<{ Body: VectorSearchRequest }>("/search/vector", async (req, reply) => {
    const body = req.body;
    const q = body.q;
    const k = body.k ?? 20;

    if (!q || typeof q !== "string") return reply.status(400).send({ error: "q is required" });

    const whereFromBody = isRecord(body.where) ? { ...body.where } : {};
    if (body.source) whereFromBody.source = body.source;
    if (body.kind) whereFromBody.kind = body.kind;
    if (body.project) whereFromBody.project = body.project;
    if (body.visibility) whereFromBody.visibility = body.visibility;

    const mongoWhere = Object.fromEntries(
      Object.entries(whereFromBody).filter(([key, value]) => (
        ["source", "kind", "project", "session", "visibility", "parent_id", "embedding_model"].includes(key)
        && !key.startsWith("$")
        && !key.includes(".")
        && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      )),
    );
    const tier = body.tier ?? "both";
    const includeHot = tier !== "compact";
    const includeCompact = tier !== "hot";
    const limit = Math.max(1, Math.min(200, Number(k)));

    const tieredHits = [];
    const embeddingRuntime = (app as any).embeddingRuntime;

    if (includeHot) {
      const result = await queryMongoVectorsByText({
        mongo: app.mongo,
        tier: "hot",
        q,
        k: limit,
        where: Object.keys(mongoWhere).length > 0 ? mongoWhere : undefined,
        getEmbeddingFunctionForModel: (model: string) => embeddingRuntime.hot.getEmbeddingFunctionForModel(model),
      });
      tieredHits.push(extractTieredVectorHits(result, "hot"));
    }

    if (includeCompact) {
      const result = await queryMongoVectorsByText({
        mongo: app.mongo,
        tier: "compact",
        q,
        k: limit,
        where: Object.keys(mongoWhere).length > 0 ? mongoWhere : undefined,
        getEmbeddingFunctionForModel: (model: string) => embeddingRuntime.compact.getEmbeddingFunctionForModel(model),
      });
      tieredHits.push(extractTieredVectorHits(result, "compact"));
    }

    const result = mergeTieredVectorHits(tieredHits, limit);
    return { ok: true, result, tier, storageBackend: "mongodb" };
  });
};
