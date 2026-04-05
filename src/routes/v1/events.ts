import type { FastifyPluginAsync } from "fastify";
import { run } from "../../lib/duckdb.js";
import { upsertEvent } from "../../lib/mongodb.js";
import { batchPreparedChunks, isContextOverflowError, prepareIndexDocument } from "../../lib/indexing.js";
import { indexTextInMongoVectors } from "../../lib/mongo-vectors.js";
import { counterInc, histogramObserve } from "../../lib/metrics.js";
import type { EventIngestRequest, EventEnvelopeV1 } from "../../lib/types.js";

function norm(v: any): string | null {
  if (v === undefined || v === null) return null;
  return String(v);
}

function toJson(v: any): string | null {
  if (v === undefined || v === null) return null;
  try { return JSON.stringify(v); } catch { return null; }
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
    const storageBackend = (app as any).storageBackend ?? "duckdb";

    for (const ev of body.events) {
      validateEvent(ev);

      const sr = ev.source_ref ?? {};
      const meta = ev.meta ?? {};
      const role = norm((meta as any).role);
      const author = norm((meta as any).author);
      const model = norm((meta as any).model);
      const tags = (meta as any).tags;

      if (storageBackend === "mongodb") {
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
      } else {
        // DuckDB storage
        await run(app.duck.conn, `
          INSERT INTO events (
            id, ts, source, kind, project, session, message, role, author, model, tags, text, attachments, extra
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            ts=excluded.ts,
            source=excluded.source,
            kind=excluded.kind,
            project=excluded.project,
            session=excluded.session,
            message=excluded.message,
            role=excluded.role,
            author=excluded.author,
            model=excluded.model,
            tags=excluded.tags,
            text=excluded.text,
            attachments=excluded.attachments,
            extra=excluded.extra
        `, [
          ev.id,
          ev.ts,
          ev.source,
          ev.kind,
          norm((sr as any).project),
          norm((sr as any).session),
          norm((sr as any).message),
          role,
          author,
          model,
          toJson(tags),
          norm(ev.text ?? ""),
          toJson(ev.attachments ?? []),
          toJson(ev.extra ?? {})
        ]);
      }

      ids.push(ev.id);

      if (ev.text) {
        try {
          const embeddingScope = {
            source: ev.source,
            kind: ev.kind,
            project: norm((sr as any).project) ?? undefined
          };

          if (storageBackend === "mongodb") {
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
          } else if (app.chroma?.enabled !== false) {
            const embeddingFunction = app.chroma.embeddingFunctionFor?.(embeddingScope) ?? app.chroma.embeddingFunction;
            const embeddingModel = app.chroma.resolveEmbeddingModel?.(embeddingScope);
            const collection = await app.chroma.client.getCollection({
              name: app.chroma.collectionName,
              embeddingFunction: embeddingFunction as any
            });
            const baseMetadata = {
              ts: ev.ts,
              source: ev.source,
              kind: ev.kind,
              project: (sr as any).project,
              session: (sr as any).session,
              author: author ?? "",
              role: role ?? "",
              model: model ?? "",
              embedding_model: embeddingModel ?? "",
              search_tier: "hot"
            } as Record<string, unknown>;

            const upsertPrepared = async (preparedDoc: ReturnType<typeof prepareIndexDocument>) => {
              if (typeof collection.delete === "function") {
                await collection.delete({ where: { parent_id: ev.id } });
              }

              for (const batch of batchPreparedChunks(preparedDoc.chunks)) {
                const ids = batch.map((chunk) => chunk.id);
                const documents = batch.map((chunk) => chunk.text);
                const metadatas = batch.map((chunk) => ({
                  ...baseMetadata,
                  parent_id: ev.id,
                  chunk_id: chunk.id,
                  chunk_index: chunk.chunkIndex,
                  chunk_count: chunk.chunkCount,
                  normalized_format: preparedDoc.normalizedFormat,
                  normalized_estimated_tokens: preparedDoc.normalizedEstimatedTokens,
                  raw_estimated_tokens: preparedDoc.rawEstimatedTokens,
                })) as any;

                if (typeof collection.upsert === "function") {
                  await collection.upsert({ ids, documents, metadatas });
                  continue;
                }
                await collection.add({ ids, documents, metadatas });
              }
            };

            const prepared = prepareIndexDocument({
              parentId: ev.id,
              text: ev.text,
              extra: (ev.extra as Record<string, unknown> | undefined) ?? {},
            });

            try {
              await upsertPrepared(prepared);
            } catch (error) {
              if (!prepared.chunked && isContextOverflowError(error)) {
                const retryPrepared = prepareIndexDocument({
                  parentId: ev.id,
                  text: ev.text,
                  extra: (ev.extra as Record<string, unknown> | undefined) ?? {},
                  forceChunking: true,
                });
                await upsertPrepared(retryPrepared);
              } else {
                throw error;
              }
            }
          }
        } catch (err) {
          app.log.error(err, storageBackend === "mongodb" ? "Failed to index event into MongoDB vectors" : "Failed to index event into ChromaDB");
          const detail = err instanceof Error ? err.message : String(err);
          return reply.status(503).send({
            ok: false,
            error: "embedding_index_failed",
            detail,
            persisted_ids: [...ids],
            failed_id: ev.id,
            storageBackend,
          });
        }
      }
    }

    const ftsEnabled = storageBackend === "mongodb" ? true : app.duck?.ftsEnabled ?? false;
    
    // Track metrics
    counterInc("openplanner_events_ingested_total", { backend: storageBackend }, ids.length);
    for (const ev of body.events) {
      counterInc("openplanner_events_by_source", { source: ev.source, backend: storageBackend });
      counterInc("openplanner_events_by_kind", { kind: ev.kind, backend: storageBackend });
    }
    
    return {
      ok: true,
      count: ids.length,
      ids,
      ftsEnabled,
      storageBackend,
      indexed: storageBackend === "mongodb" ? true : app.chroma?.enabled !== false,
      indexing: storageBackend === "mongodb" ? "required" : (app.chroma?.enabled === false ? "disabled" : "required"),
    };
  });
};
