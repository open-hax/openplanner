/**
 * Session listing/detail cores extracted from the REST API's /v1/sessions
 * handlers. Response shapes are byte-identical to the REST bodies so direct
 * SDK consumers (knoxx) and REST clients see the same data.
 */
import { createProtocols } from "./protocol-adapters.js";
import type { MongoConnection } from "./mongodb.js";

export interface SessionsContext {
  mongo: MongoConnection;
}

export type SessionDetailMode = "full" | "resume" | "visibility";

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

export async function listSessionsResponse(
  ctx: SessionsContext,
  query: { project?: unknown; limit?: unknown; offset?: unknown } = {},
) {
  const protocols = createProtocols({ mongo: ctx.mongo });
  const project = typeof query.project === "string" ? query.project.trim() : "";
  const limit = Math.min(parsePositiveInt(query.limit, 50), 500);
  const offset = Math.max(0, Number.parseInt(String(query.offset ?? "0"), 10) || 0);

  const { rows, total } = await protocols.sessionManagement.listSessions({ project, limit, offset });

  return {
    ok: true,
    rows: jsonSafe(rows),
    total,
    offset,
    limit,
    has_more: offset + rows.length < total,
    storageBackend: "mongodb" as const,
  };
}

export async function getSessionResponse(
  ctx: SessionsContext,
  sessionId: string,
  query: { project?: unknown; mode?: unknown; limit?: unknown } = {},
) {
  if (!sessionId) throw new Error("sessionId required");
  const protocols = createProtocols({ mongo: ctx.mongo });
  const project = typeof query.project === "string" ? query.project.trim() : "";
  const mode = (typeof query.mode === "string" ? query.mode.trim() : "resume") as SessionDetailMode;

  if (mode === "visibility") {
    const rows = await protocols.sessionManagement.getSessionEvents(sessionId, {
      project,
      limit: parsePositiveInt(query.limit, 32),
      projection: { _id: 0, extra: 1 },
    });
    return { ok: true, session: sessionId, rows: jsonSafe(rows), storageBackend: "mongodb" as const };
  }

  if (mode === "resume") {
    const limit = Math.min(parsePositiveInt(query.limit, 240), 1000);
    const rows = await protocols.sessionManagement.getSessionEvents(sessionId, {
      project,
      limit,
      kind: "knoxx.message",
      sort: "desc",
    });
    rows.reverse();
    return { ok: true, session: sessionId, rows: jsonSafe(normalizeSessionRows(rows)), storageBackend: "mongodb" as const };
  }

  const rows = await protocols.sessionManagement.getSessionEvents(sessionId, {
    project,
    limit: 100000,
    sort: "asc",
  });
  return { ok: true, session: sessionId, rows: jsonSafe(normalizeSessionRows(rows)), storageBackend: "mongodb" as const };
}
