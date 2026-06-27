import type { FastifyPluginAsync } from "fastify";
import { createProtocols } from "../../lib/protocol-adapters.js";

type SessionRow = {
  project: string;
  session: string;
  last_ts: string | number | null;
  event_count: number;
};

type SessionDetailMode = "full" | "resume" | "visibility";

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

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeSessionRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row,
    ts: normalizeTimestamp(row.ts),
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt),
  }));
}

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  const protocols = createProtocols(app);

  app.get("/sessions", async (req: any) => {
    const project = typeof req.query?.project === "string" ? req.query.project.trim() : "";
    const limit = Math.min(parsePositiveInt(req.query?.limit, 50), 500);
    const offset = Math.max(0, Number.parseInt(String(req.query?.offset ?? "0"), 10) || 0);

    const { rows, total } = await protocols.sessionManagement.listSessions({ project, limit, offset });

    return {
      ok: true,
      rows: jsonSafe(rows),
      total,
      offset,
      limit,
      has_more: offset + rows.length < total,
      storageBackend: "mongodb",
    };
  });

  app.get("/sessions/:sessionId", async (req: any, reply) => {
    const { sessionId } = req.params as any;
    const project = typeof req.query?.project === "string" ? req.query.project.trim() : "";
    const mode = (typeof req.query?.mode === "string" ? req.query.mode.trim() : "resume") as SessionDetailMode;
    if (!sessionId) {
      return reply.code(400).send({ ok: false, error: "sessionId required" });
    }

    if (mode === "visibility") {
      const rows = await protocols.sessionManagement.getSessionEvents(sessionId, {
        project,
        limit: parsePositiveInt(req.query?.limit, 32),
        projection: { _id: 0, extra: 1 },
      });
      return { ok: true, session: sessionId, rows: jsonSafe(rows), storageBackend: "mongodb" };
    }

    if (mode === "resume") {
      const limit = Math.min(parsePositiveInt(req.query?.limit, 240), 1000);
      const rows = await protocols.sessionManagement.getSessionEvents(sessionId, {
        project,
        limit,
        kind: "knoxx.message",
        sort: "desc",
      });
      rows.reverse();
      return { ok: true, session: sessionId, rows: jsonSafe(normalizeSessionRows(rows)), storageBackend: "mongodb" };
    }

    const rows = await protocols.sessionManagement.getSessionEvents(sessionId, {
      project,
      limit: 100000,
      sort: "asc",
    });
    return { ok: true, session: sessionId, rows: jsonSafe(normalizeSessionRows(rows)), storageBackend: "mongodb" };
  });
};
