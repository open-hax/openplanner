import type { FastifyPluginAsync } from "fastify";

type SessionRow = {
  project: string;
  session: string;
  last_ts: string | number | null;
  event_count: number;
};

function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === "bigint") return Number(v);
      return v;
    })
  ) as T;
}

function normalizeTimestamp(value: unknown): string | number | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" || typeof value === "string") return value;
  return null;
}

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/sessions", async (req: any) => {
    const project = typeof req.query?.project === "string" ? req.query.project.trim() : "";

    const match: Record<string, unknown> = { session: { $type: "string", $ne: "" } };
    if (project) match.project = project;
    
    const rawRows = await app.mongo.events.aggregate([
      { $match: match },
      {
        $group: {
          _id: { project: { $ifNull: ["$project", ""] }, session: { $ifNull: ["$session", ""] } },
          last_ts: { $max: "$ts" },
          event_count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          project: "$_id.project",
          session: "$_id.session",
          last_ts: "$last_ts",
          event_count: "$event_count",
        },
      },
      { $sort: { last_ts: -1 } },
      { $limit: 500 },
    ]).toArray();

    const rows = (rawRows as SessionRow[]).map((row) => ({
      ...row,
      last_ts: normalizeTimestamp(row.last_ts),
      event_count: typeof row.event_count === "bigint" ? Number(row.event_count) : row.event_count,
    }));

    return { ok: true, rows: jsonSafe(rows), storageBackend: "mongodb" };
  });

  app.get("/sessions/:sessionId", async (req: any, reply) => {
    const { sessionId } = req.params as any;
    const project = typeof req.query?.project === "string" ? req.query.project.trim() : "";
    if (!sessionId) {
      return reply.code(400).send({ ok: false, error: "sessionId required" });
    }

    const filter: Record<string, unknown> = { session: sessionId };
    if (project) filter.project = project;
    
    const rows = await app.mongo.events.find(filter).sort({ ts: 1 }).limit(100000).toArray();
    return { ok: true, session: sessionId, rows: jsonSafe(rows), storageBackend: "mongodb" };
  });
};
