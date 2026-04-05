import type { FastifyPluginAsync } from "fastify";
import { all, run } from "../../lib/duckdb.js";
import { deleteMongoVectorEntriesByFilter } from "../../lib/mongo-vectors.js";

type LakeSummary = {
  project: string;
  totalEvents: number;
  latestTs: string | null;
  kinds: Record<string, number>;
};

function toSafeNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function collateLakeRows(
  rows: Array<{ project?: unknown; kind?: unknown; count?: unknown; latestTs?: unknown }>,
): LakeSummary[] {
  const byProject = new Map<string, LakeSummary>();

  for (const row of rows) {
    const project = String(row.project ?? "").trim();
    if (!project) continue;

    const kind = String(row.kind ?? "unknown").trim() || "unknown";
    const count = toSafeNumber(row.count);
    const latestTs = toIsoString(row.latestTs);

    const current = byProject.get(project) ?? {
      project,
      totalEvents: 0,
      latestTs: null,
      kinds: {},
    };

    current.totalEvents += count;
    current.kinds[kind] = (current.kinds[kind] ?? 0) + count;

    if (latestTs && (!current.latestTs || Date.parse(latestTs) > Date.parse(current.latestTs))) {
      current.latestTs = latestTs;
    }

    byProject.set(project, current);
  }

  return [...byProject.values()].sort((a, b) => a.project.localeCompare(b.project));
}

export const lakeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/lakes", async () => {
    const storageBackend = (app as any).storageBackend ?? "duckdb";

    if (storageBackend === "mongodb") {
      const db = (app as any).mongo;
      const rows = await db.events.aggregate([
        {
          $match: {
            project: { $type: "string", $ne: "" },
          },
        },
        {
          $group: {
            _id: { project: "$project", kind: "$kind" },
            count: { $sum: 1 },
            latestTs: { $max: "$ts" },
          },
        },
        {
          $project: {
            _id: 0,
            project: "$_id.project",
            kind: "$_id.kind",
            count: 1,
            latestTs: 1,
          },
        },
        {
          $sort: { project: 1, kind: 1 },
        },
      ]).toArray();

      const lakes = collateLakeRows(rows);
      return { ok: true, count: lakes.length, lakes, storageBackend: "mongodb" };
    }

    const duck = (app as any).duck as { conn: unknown } | undefined;
    if (!duck) {
      return { ok: true, count: 0, lakes: [], storageBackend: "duckdb" };
    }

    const rows = await all<{ project?: unknown; kind?: unknown; count?: unknown; latestTs?: unknown }>(
      (duck as any).conn,
      `SELECT project, kind, COUNT(*) as count, MAX(ts) as latestTs
       FROM events
       WHERE project IS NOT NULL AND project <> ''
       GROUP BY project, kind
       ORDER BY project ASC, kind ASC`,
    );

    const lakes = collateLakeRows(rows);
    return { ok: true, count: lakes.length, lakes, storageBackend: "duckdb" };
  });

  app.post("/lakes/purge", async (req: any, reply) => {
    const storageBackend = (app as any).storageBackend ?? "duckdb";
    const projects = Array.isArray(req.body?.projects)
      ? req.body.projects.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const sources = Array.isArray(req.body?.sources)
      ? req.body.sources.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const kinds = Array.isArray(req.body?.kinds)
      ? req.body.kinds.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
      : [];

    if (projects.length === 0 && sources.length === 0 && kinds.length === 0) {
      return reply.code(400).send({ ok: false, error: "at least one of projects[], sources[], or kinds[] is required" });
    }

    let deletedEvents = 0;
    let deletedCompacted = 0;

    if (storageBackend === "mongodb") {
      const db = (app as any).mongo;
      const filter: Record<string, unknown> = {};
      if (projects.length > 0) filter.project = { $in: projects };
      if (sources.length > 0) filter.source = { $in: sources };
      if (kinds.length > 0) filter.kind = { $in: kinds };
      const eventsResult = await db.events.deleteMany(filter);
      const compactedResult = await db.compacted.deleteMany(filter);
      await deleteMongoVectorEntriesByFilter(db, "hot", filter);
      await deleteMongoVectorEntriesByFilter(db, "compact", filter);
      deletedEvents = Number(eventsResult.deletedCount ?? 0);
      deletedCompacted = Number(compactedResult.deletedCount ?? 0);
    } else {
      const duck = (app as any).duck as { conn: unknown } | undefined;
      if (!duck) {
        return { ok: true, storageBackend: "duckdb", projects, sources, kinds, deletedEvents: 0, deletedCompacted: 0, chroma: { hot: false, compact: false } };
      }

      const whereParts: string[] = [];
      const params: unknown[] = [];
      if (projects.length > 0) {
        whereParts.push(`project IN (${projects.map(() => "?").join(", ")})`);
        params.push(...projects);
      }
      if (sources.length > 0) {
        whereParts.push(`source IN (${sources.map(() => "?").join(", ")})`);
        params.push(...sources);
      }
      if (kinds.length > 0) {
        whereParts.push(`kind IN (${kinds.map(() => "?").join(", ")})`);
        params.push(...kinds);
      }
      const whereSql = whereParts.join(" AND ");
      const eventRows = await all<{ count?: unknown }>((duck as any).conn, `SELECT COUNT(*) as count FROM events WHERE ${whereSql}`, params);
      const compactedRows = await all<{ count?: unknown }>((duck as any).conn, `SELECT COUNT(*) as count FROM compacted_memories WHERE ${whereSql}`, params);
      deletedEvents = toSafeNumber(eventRows[0]?.count);
      deletedCompacted = toSafeNumber(compactedRows[0]?.count);

      await run((duck as any).conn, `DELETE FROM events WHERE ${whereSql}`, params);
      await run((duck as any).conn, `DELETE FROM compacted_memories WHERE ${whereSql}`, params);
    }

    let hotDeleted = false;
    let compactDeleted = false;
    if (app.chroma?.enabled !== false) {
      try {
        const hot = await app.chroma.client.getCollection({
          name: app.chroma.collectionName,
          embeddingFunction: app.chroma.embeddingFunction as never,
        });
        const where: Record<string, unknown> = {};
        if (projects.length > 0) where.project = { $in: projects };
        if (sources.length > 0) where.source = { $in: sources };
        if (kinds.length > 0) where.kind = { $in: kinds };
        await hot.delete({ where: where as never });
        hotDeleted = true;
      } catch {}

      try {
        const compact = await app.chroma.client.getCollection({
          name: app.chroma.compactCollectionName,
          embeddingFunction: app.chroma.compactEmbeddingFunction as never,
        });
        const where: Record<string, unknown> = {};
        if (projects.length > 0) where.project = { $in: projects };
        if (sources.length > 0) where.source = { $in: sources };
        if (kinds.length > 0) where.kind = { $in: kinds };
        await compact.delete({ where: where as never });
        compactDeleted = true;
      } catch {}
    }

    return {
      ok: true,
      storageBackend,
      projects,
      sources,
      kinds,
      deletedEvents,
      deletedCompacted,
      chroma: {
        hot: hotDeleted,
        compact: compactDeleted,
      },
    };
  });
};
