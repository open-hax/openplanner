import type { FastifyPluginAsync } from "fastify";
import { all } from "../../lib/duckdb.js";

type SessionRow = {
  project: string;
  session: string;
  last_ts: string | number | bigint | null;
  event_count: number | bigint;
};

function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === "bigint") return Number(v);
      return v;
    })
  ) as T;
}

function toJsonSafeNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function normalizeTimestamp(value: SessionRow["last_ts"]): string | number | null {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return value;
}

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/sessions", async (req: any) => {
    const project = typeof req.query?.project === "string" ? req.query.project.trim() : "";
    const storageBackend = (app as any).storageBackend ?? "duckdb";

    if (storageBackend === "mongodb") {
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
        event_count: toJsonSafeNumber(row.event_count)
      }));

      return { ok: true, rows: jsonSafe(rows) };
    }

    const params: unknown[] = [];
    let sql = `
      SELECT
        coalesce(project, '') AS project,
        coalesce(session, '') AS session,
        max(ts) AS last_ts,
        count(*)::BIGINT AS event_count
      FROM events
      WHERE session IS NOT NULL AND session <> ''
    `;

    if (project) {
      sql += " AND project = ?";
      params.push(project);
    }

    sql += `
      GROUP BY 1,2
      ORDER BY last_ts DESC
      LIMIT 500
    `;

    const rawRows = await all(app.duck.conn, sql, params);

    const rows = (rawRows as SessionRow[]).map((row) => ({
      ...row,
      last_ts: normalizeTimestamp(row.last_ts),
      event_count: toJsonSafeNumber(row.event_count)
    }));

    return { ok: true, rows: jsonSafe(rows) };
  });

  app.get("/sessions/:sessionId", async (req: any, reply) => {
    const { sessionId } = req.params as any;
    const project = typeof req.query?.project === "string" ? req.query.project.trim() : "";
    if (!sessionId) {
      return reply.code(400).send({ ok: false, error: "sessionId required" });
    }

    const storageBackend = (app as any).storageBackend ?? "duckdb";
    if (storageBackend === "mongodb") {
      const filter: Record<string, unknown> = { session: sessionId };
      if (project) filter.project = project;
      const rows = await app.mongo.events.find(filter).sort({ ts: 1 }).limit(100000).toArray();
      return { ok: true, session: sessionId, rows: jsonSafe(rows) };
    }

    const params: unknown[] = [sessionId];
    let sql = `
      SELECT id, ts, source, kind, project, session, message, role, author, model, text, attachments, extra
      FROM events
      WHERE session = ?
    `;
    if (project) {
      sql += " AND project = ?";
      params.push(project);
    }
    sql += `
      ORDER BY ts ASC
      LIMIT 100000
    `;

    const rows = await all(app.duck.conn, sql, params);

    return { ok: true, session: sessionId, rows: jsonSafe(rows) };
  });
};
