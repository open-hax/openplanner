/**
 * Raw collection browse/query cores extracted from the REST API's
 * /v1/mongo/collections and /v1/mongo/query handlers. Shared by the route and
 * direct SDK consumers so shapes match exactly.
 */
import type { MongoConnection } from "./mongodb.js";

const ALLOWED_SORT_DIRECTIONS = new Set([1, -1]);

export function sanitizeCollectionName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  // MongoDB collection names: no empty, no system.*, no null bytes, max 120 chars
  if (!trimmed || trimmed.length > 120) return null;
  if (trimmed.startsWith("system.")) return null;
  if (trimmed.includes("\0")) return null;
  // Allow alphanumeric, dots, underscores, hyphens
  if (!/^[a-zA-Z0-9._\-]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * List all MongoDB collections with document counts. Uses
 * estimatedDocumentCount() (collection metadata, O(1)) instead of
 * countDocuments() (full scan).
 */
export async function listCollectionsResponse(ctx: { mongo: MongoConnection }) {
  const db = ctx.mongo.db;
  const collections = await db.listCollections().toArray();

  const results = await Promise.all(
    collections.map(async (col: { name: string; type?: string }) => {
      const name = col.name;
      try {
        const count = await db.collection(name).estimatedDocumentCount();
        return { name, count, type: col.type ?? "collection" };
      } catch {
        return { name, count: -1, type: col.type ?? "collection" };
      }
    }),
  );

  return {
    ok: true,
    collections: results.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Query a specific collection. Throws on an invalid collection name — HTTP
 * shells map that to a 400.
 */
export async function queryCollectionResponse(ctx: { mongo: MongoConnection }, body: Record<string, unknown>) {
  const collectionName = sanitizeCollectionName(body.collection);
  if (!collectionName) throw new Error("Invalid collection name");

  const db = ctx.mongo.db;
  const collection = db.collection(collectionName);

  let filter: Record<string, unknown> = {};
  if (body.filter && typeof body.filter === "object" && !Array.isArray(body.filter)) {
    filter = body.filter as Record<string, unknown>;
  }

  const rawLimit = Number(body.limit);
  const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 50 : rawLimit, 500));

  const rawSkip = Number(body.skip);
  const skip = Math.max(0, isNaN(rawSkip) ? 0 : rawSkip);

  let sort: Record<string, 1 | -1> = { _id: -1 };
  if (body.sort && typeof body.sort === "object" && !Array.isArray(body.sort)) {
    const rawSort = body.sort as Record<string, unknown>;
    const parsed: Record<string, 1 | -1> = {};
    for (const [k, v] of Object.entries(rawSort)) {
      const dir = Number(v);
      if (ALLOWED_SORT_DIRECTIONS.has(dir)) {
        parsed[k] = dir as 1 | -1;
      }
    }
    if (Object.keys(parsed).length > 0) sort = parsed;
  }

  let projection: Record<string, number> | undefined;
  if (body.projection && typeof body.projection === "object" && !Array.isArray(body.projection)) {
    projection = body.projection as Record<string, number>;
  }

  const total = await collection.countDocuments(filter);
  const cursor = collection.find(filter, { projection }).sort(sort).skip(skip).limit(limit);
  const rows = await cursor.toArray();

  return {
    ok: true,
    collection: collectionName,
    count: rows.length,
    total,
    skip,
    limit,
    rows,
  };
}
