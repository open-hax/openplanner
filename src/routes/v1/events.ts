import type { FastifyPluginAsync } from "fastify";
import { upsertEvent, upsertGraphEdges, upsertGraphNodeEmbeddings } from "../../lib/mongodb.js";
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: EventIngestRequest }>("/events", async (req, reply) => {
    const body = req.body;
    if (!body || !Array.isArray(body.events)) return reply.status(400).send({ error: "expected { events: [...] }" });

    const ids: string[] = [];
    const projectedGraphEdges: Array<{
      source_node_id: string;
      target_node_id: string;
      edge_kind: string;
      layer?: string | null;
      project?: string | null;
      source?: string | null;
      data?: Record<string, unknown> | null;
      updated_at?: Date;
    }> = [];
    const graphNodeEmbeddingInputs: Array<{
      node_id: string;
      source_event_id: string;
      project?: string | null;
      text: string;
    }> = [];

    for (const ev of body.events) {
      validateEvent(ev);

      const sr = ev.source_ref ?? {};
      const meta = ev.meta ?? {};
      const extra = (ev.extra as Record<string, unknown> | undefined) ?? {};
      const role = norm((meta as any).role);
      const author = norm((meta as any).author);
      const model = norm((meta as any).model);
      const tags = (meta as any).tags;
      const project = norm((sr as any).project);

      // MongoDB storage
      await upsertEvent(app.mongo.events, {
        id: ev.id,
        ts: new Date(ev.ts),
        source: ev.source,
        kind: ev.kind,
        project,
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

      if (ev.kind === "graph.edge") {
        const sourceNodeId = norm(extra.source_node_id)?.trim() ?? "";
        const targetNodeId = norm(extra.target_node_id)?.trim() ?? "";
        const edgeKind = (norm(extra.edge_type) ?? norm(extra.edge_kind) ?? "").trim();
        if (sourceNodeId && targetNodeId && edgeKind && sourceNodeId !== targetNodeId) {
          projectedGraphEdges.push({
            source_node_id: sourceNodeId,
            target_node_id: targetNodeId,
            edge_kind: edgeKind,
            layer: norm(extra.layer),
            project,
            source: ev.source,
            data: extra,
            updated_at: new Date(ev.ts),
          });
        }
      }

      if (ev.kind === "graph.node") {
        const nodeId = norm(extra.node_id)?.trim() ?? norm((sr as any).message)?.trim() ?? "";
        const preview = norm(extra.preview)?.trim() ?? "";
        const directText = norm(ev.text)?.trim() ?? "";
        const body = directText || preview;
        if (nodeId && body) {
          graphNodeEmbeddingInputs.push({
            node_id: nodeId,
            source_event_id: ev.id,
            project,
            text: body,
          });
        }
      }

      if (ev.text) {
        try {
          const embeddingScope = {
            source: ev.source,
            kind: ev.kind,
            project: project ?? undefined
          };

          const embeddingRuntime = (app as any).embeddingRuntime;
          const embeddingFunction = embeddingRuntime.hot.getEmbeddingFunction(embeddingScope);
          const embeddingModel = embeddingRuntime.hot.getModel(embeddingScope);
          await withTimeout(indexTextInMongoVectors({
            mongo: app.mongo,
            tier: "hot",
            parentId: ev.id,
            text: ev.text,
            extra,
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
              visibility: extra.visibility ?? "internal",
              title: extra.title ?? (sr as any).message ?? ev.id,
            },
            embeddingFunction,
          }), 2000, `event vector index ${ev.id}`);
        } catch (err) {
          app.log.warn({ err, eventId: ev.id }, "Failed to index event into MongoDB vectors; preserving base event without embeddings");
        }
      }
    }

    if (projectedGraphEdges.length > 0) {
      await upsertGraphEdges(app.mongo.graphEdges, projectedGraphEdges);
    }

    if (graphNodeEmbeddingInputs.length > 0) {
      try {
        const embeddingRuntime = (app as any).embeddingRuntime;
        const groupedByModel = new Map<string, Array<(typeof graphNodeEmbeddingInputs)[number]>>();

        for (const input of graphNodeEmbeddingInputs) {
          const model = embeddingRuntime.hot.getModel({
            source: "graph-event",
            kind: "graph.node",
            project: input.project ?? undefined,
          });
          const rows = groupedByModel.get(model) ?? [];
          rows.push(input);
          groupedByModel.set(model, rows);
        }

        for (const [model, rows] of groupedByModel) {
          const embeddingFunction = embeddingRuntime.hot.getEmbeddingFunctionForModel(model);
          const embeddings = await withTimeout(
            embeddingFunction.generate(rows.map((row) => row.text)) as Promise<number[][]>,
            10_000,
            `graph node embedding batch ${model}`,
          );

          const storedRows = rows.flatMap((row, idx) => {
            const embedding = embeddings[idx];
            if (!Array.isArray(embedding) || embedding.length === 0) return [];
            return [{
              node_id: row.node_id,
              source_event_id: row.source_event_id,
              project: row.project ?? null,
              embedding_model: model,
              embedding_dimensions: embedding.length,
              embedding,
              chunk_count: 1,
              text: row.text,
              updated_at: new Date(),
            }];
          });

          if (storedRows.length > 0) {
            await upsertGraphNodeEmbeddings(app.mongo.graphNodeEmbeddings, storedRows);
          }
        }
      } catch (err) {
        app.log.warn({ err, count: graphNodeEmbeddingInputs.length }, "Failed to materialize graph node embeddings during event ingest");
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
      projectedGraphEdges: projectedGraphEdges.length,
      ftsEnabled: true,
      storageBackend: "mongodb",
      indexed: true,
      indexing: "required",
    };
  });
};
