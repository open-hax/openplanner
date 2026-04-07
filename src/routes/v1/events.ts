import type { FastifyPluginAsync } from "fastify";
import { upsertEvent } from "../../lib/mongodb.js";
import { batchPreparedChunks, isContextOverflowError, prepareIndexDocument } from "../../lib/indexing.js";
import { indexTextInMongoVectors } from "../../lib/mongo-vectors.js";
import { counterInc } from "../../lib/metrics.js";
import type { EventIngestRequest, EventEnvelopeV1 } from "../../lib/types.js";

function norm(v: any): string | null {
  if (v === undefined || v === null) return null;
  return String(v);
}

function validateEvent(ev: EventEnvelopeV1) {
  if (!ev || ev.schema !== "openplanner.event.v1") throw new Error("event.schema must be openplanner.event.v1");
  if (!ev.id) throw new Error("event.id required");
  if (!ev.ts) throw new Error("event.ts required (ISO)");
  if (!ev.source) throw new Error("event.source required");
  if (!ev.kind) throw new Error("event.kind required");
}

export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: EventIngestRequest }>("/events", async (req, reply) => {
    const body = req.body;
    if (!body || !Array.isArray(body.events)) return reply.status(400).send({ error: "expected { events: [...] }" });

    const ids: string[] = [];

    for (const ev of body.events) {
      validateEvent(ev);

      const sr = ev.source_ref ?? {};
      const meta = ev.meta ?? {};
      const role = norm((meta as any).role);
      const author = norm((meta as any).author);
      const model = norm((meta as any).model);
      const tags = (meta as any).tags;

      // MongoDB storage
      await upsertEvent(app.mongo.events, {
        id: ev.id,
        ts: new Date(ev.ts),
        source: ev.source,
        kind: ev.kind,
        project: norm((sr as any).project),
        session: norm((sr as any).session),
        message: norm((sr as any).message),
        role,
        author,
        model,
        tags: tags ?? null,
        text: norm(ev.text ?? ""),
        attachments: ev.attachments ?? null,
        extra: ev.extra ?? null,
      });

      ids.push(ev.id);

      if (ev.text) {
        try {
          const embeddingScope = {
            source: ev.source,
            kind: ev.kind,
            project: norm((sr as any).project) ?? undefined
          };

          const embeddingRuntime = (app as any).embeddingRuntime;
          const embeddingFunction = embeddingRuntime.hot.getEmbeddingFunction(embeddingScope);
          const embeddingModel = embeddingRuntime.hot.getModel(embeddingScope);
          await indexTextInMongoVectors({
            mongo: app.mongo,
            tier: "hot",
            parentId: ev.id,
            text: ev.text,
            extra: (ev.extra as Record<string, unknown> | undefined) ?? {},
            metadata: {
              ts: ev.ts,
              source: ev.source,
              kind: ev.kind,
              project: (sr as any).project,
              session: (sr as any).session,
              author: author ?? "",
              role: role ?? "",
              model: model ?? "",
              embedding_model: embeddingModel ?? "",
              search_tier: "hot",
              visibility: (ev.extra as Record<string, unknown> | undefined)?.visibility ?? "internal",
              title: (ev.extra as Record<string, unknown> | undefined)?.title ?? (sr as any).message ?? ev.id,
            },
            embeddingFunction,
          });
        } catch (err) {
          app.log.error(err, "Failed to index event into MongoDB vectors");
          const detail = err instanceof Error ? err.message : String(err);
          return reply.status(503).send({
            ok: false,
            error: "embedding_index_failed",
            detail,
            persisted_ids: [...ids],
            failed_id: ev.id,
            storageBackend: "mongodb",
          });
        }
      }
    }
    
    // Track metrics
    counterInc("openplanner_events_ingested_total", { backend: "mongodb" }, ids.length);
    for (const ev of body.events) {
      counterInc("openplanner_events_by_source", { source: ev.source, backend: "mongodb" });
      counterInc("openplanner_events_by_kind", { kind: ev.kind, backend: "mongodb" });
    }
    
    return {
      ok: true,
      count: ids.length,
      ids,
      ftsEnabled: true,
      storageBackend: "mongodb",
      indexed: true,
      indexing: "required",
    };
  });
};
