/**
 * Search cores extracted from the REST API's /v1/search/fts and
 * /v1/search/vector handlers. The route (and any SDK embedder, e.g. knoxx's
 * direct-mongo client) share this logic so results are identical either way.
 */
import { ftsSearch, ilikeSearch } from "./mongodb.js";
import type { MongoConnection } from "./mongodb.js";
import { queryMongoVectorsByText } from "./mongo-vectors.js";
import type { FtsSearchRequest, VectorSearchRequest } from "./types.js";
import { extractTieredVectorHits, mergeTieredVectorHits } from "./vector-search.js";
import type { EmbeddingRuntime } from "./embedding-runtime.js";

export interface SearchContext {
  mongo: MongoConnection;
  embeddingRuntime: EmbeddingRuntime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type QualityMode = "good" | "not_bad" | "any" | "good_then_not_bad";

export function qualityMode(value: unknown): QualityMode {
  const normalized = String(value ?? "good_then_not_bad").trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "good" || normalized === "not_bad" || normalized === "any" || normalized === "good_then_not_bad") {
    return normalized;
  }
  return "good_then_not_bad";
}

function rowId(row: unknown): string {
  if (!isRecord(row)) return "";
  return String(row.id ?? row._id ?? "");
}

function firstNestedArray<T>(value: unknown): T[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const first = value[0];
  return Array.isArray(first) ? first as T[] : [];
}

function mergeVectorPayloads(first: Record<string, unknown>, second: Record<string, unknown>, limit: number): Record<string, unknown> {
  const ids = [...firstNestedArray<string>(first.ids)];
  const documents = [...firstNestedArray<string>(first.documents)];
  const metadatas = [...firstNestedArray<Record<string, unknown>>(first.metadatas)];
  const distances = [...firstNestedArray<number | null>(first.distances)];
  const seen = new Set(ids);

  firstNestedArray<string>(second.ids).forEach((id, index) => {
    if (seen.has(id) || ids.length >= limit) return;
    seen.add(id);
    ids.push(id);
    documents.push(firstNestedArray<string>(second.documents)[index] ?? "");
    metadatas.push(firstNestedArray<Record<string, unknown>>(second.metadatas)[index] ?? {});
    distances.push(firstNestedArray<number | null>(second.distances)[index] ?? null);
  });

  return { ids: [ids], documents: [documents], metadatas: [metadatas], distances: [distances], include: ["documents", "metadatas", "distances"] };
}

export async function ftsSearchWithQuality(ctx: SearchContext, body: FtsSearchRequest) {
  const q = body.q;
  const limit = body.limit ?? 20;
  if (!q || typeof q !== "string") throw new Error("q is required");

  const lim = Math.max(1, Math.min(200, Number(limit)));
  const tier = body.tier ?? "both";
  const mode = qualityMode(body.quality ?? (body as any).output_quality);

  const runFts = async (quality: "good" | "not_bad" | "any", remainingLimit = lim, excludeIds: string[] = []) => {
    const options = {
      limit: remainingLimit,
      source: body.source,
      kind: body.kind,
      project: body.project,
      session: body.session,
      visibility: body.visibility,
      quality,
      excludeIds,
    };
    try {
      return { ftsEnabled: true, rows: await ftsSearch(ctx.mongo.events, q, options) };
    } catch {
      return { ftsEnabled: false, rows: await ilikeSearch(ctx.mongo.events, q, options) };
    }
  };

  if (mode === "good_then_not_bad") {
    const good = await runFts("good");
    const goodRows = good.rows;
    const shortfall = lim - goodRows.length;
    if (shortfall <= 0) {
      return { ok: true, ftsEnabled: good.ftsEnabled, count: goodRows.length, rows: goodRows, tier, qualityMode: mode, storageBackend: "mongodb" as const };
    }
    const notBad = await runFts("not_bad", shortfall, goodRows.map(rowId).filter(Boolean));
    const rows = [...goodRows, ...notBad.rows].slice(0, lim);
    return { ok: true, ftsEnabled: good.ftsEnabled && notBad.ftsEnabled, count: rows.length, rows, tier, qualityMode: mode, storageBackend: "mongodb" as const };
  }

  const result = await runFts(mode);
  return { ok: true, ftsEnabled: result.ftsEnabled, count: result.rows.length, rows: result.rows, tier, qualityMode: mode, storageBackend: "mongodb" as const };
}

export async function vectorSearchWithQuality(ctx: SearchContext, body: VectorSearchRequest) {
  const q = body.q;
  const k = body.k ?? 20;

  if (!q || typeof q !== "string") throw new Error("q is required");

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
  const mode = qualityMode(body.quality ?? (body as any).output_quality);

  const embeddingRuntime = ctx.embeddingRuntime;

  const runVector = async (quality: "good" | "not_bad" | "any", vectorLimit = limit) => {
    const where: Record<string, unknown> = { ...mongoWhere };
    if (quality === "good") where.quality_label = "good";
    if (quality === "not_bad") where.quality_label = { $ne: "bad" };
    const tieredHits = [];

    if (includeHot) {
      const result = await queryMongoVectorsByText({
        mongo: ctx.mongo,
        tier: "hot",
        q,
        k: vectorLimit,
        where: Object.keys(where).length > 0 ? where : undefined,
        getEmbeddingFunctionForModel: (model: string) => embeddingRuntime.hot.getEmbeddingFunctionForModel(model),
      });
      tieredHits.push(extractTieredVectorHits(result, "hot"));
    }

    if (includeCompact) {
      const result = await queryMongoVectorsByText({
        mongo: ctx.mongo,
        tier: "compact",
        q,
        k: vectorLimit,
        where: Object.keys(where).length > 0 ? where : undefined,
        getEmbeddingFunctionForModel: (model: string) => embeddingRuntime.compact.getEmbeddingFunctionForModel(model),
      });
      tieredHits.push(extractTieredVectorHits(result, "compact"));
    }

    return mergeTieredVectorHits(tieredHits, vectorLimit);
  };

  if (mode === "good_then_not_bad") {
    const good = runVector("good");
    const goodResult = await good;
    const goodCount = firstNestedArray<string>(goodResult.ids).length;
    const result = goodCount >= limit ? goodResult : mergeVectorPayloads(goodResult, await runVector("not_bad", limit), limit);
    return { ok: true, result, tier, qualityMode: mode, storageBackend: "mongodb" as const };
  }

  const result = await runVector(mode);
  return { ok: true, result, tier, qualityMode: mode, storageBackend: "mongodb" as const };
}
