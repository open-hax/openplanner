import type { FastifyPluginAsync } from "fastify";
import { JobQueue, type Job } from "../../lib/jobs.js";
import { paths } from "../../lib/paths.js";
import { upsertGraphEdges, upsertGraphNodeEmbeddings } from "../../lib/mongodb.js";

export const jobRoutes: FastifyPluginAsync = async (app) => {
  if (!(app as any).jobs) {
    const cfg = (app as any).openplannerConfig;
    const p = paths(cfg.dataDir);
    const jq = new JobQueue(p.jobsPath);
    await jq.init();
    (app as any).jobs = jq;
  }

  const jobs = (): JobQueue => (app as any).jobs as JobQueue;

  const runBackfillEmbeddingsJob = (job: Job): void => {
    const body = (job.input as any) ?? {};

    void (async () => {
      try {
        await jobs().update(job.id, { status: "running" });
        const { batchIndexTextsInMongoVectors } = await import("../../lib/mongo-vectors.js");
        const cfg = (app as any).openplannerConfig;
        const embeddingRuntime = (app as any).embeddingRuntime;

        const events = await app.mongo.events.find({ text: { $type: "string", $ne: "" } }).toArray();

        const items = events.map((row) => ({
          id: row.id,
          text: row.text ?? "",
          extra: row.extra as Record<string, unknown> | undefined,
          metadata: {
            ts: row.ts.toISOString(),
            source: row.source,
            kind: row.kind,
            project: row.project ?? "",
            session: row.session ?? "",
            author: row.author ?? "",
            role: row.role ?? "",
            model: row.model ?? "",
            embedding_model: embeddingRuntime.hot.getModel({ source: row.source, kind: row.kind, project: row.project ?? undefined }),
            search_tier: "hot",
            visibility: (row.extra as Record<string, unknown> | undefined)?.visibility ?? "internal",
            title: (row.extra as Record<string, unknown> | undefined)?.title ?? row.message ?? row.id,
          },
        }));

        const result = await batchIndexTextsInMongoVectors({
          mongo: app.mongo,
          tier: "hot",
          items,
          embeddingFunction: embeddingRuntime.hot.getEmbeddingFunction({}),
          config: {
            concurrency: 16,
            embeddingBatchSize: 256,
            mongoBatchSize: 100,
            onProgress: async (phase, completed, total) => {
              if (completed % 100 === 0 || completed === total) {
                await jobs().update(job.id, {
                  output: { phase, completed, total },
                });
              }
            },
          },
        });

        await jobs().update(job.id, {
          status: "done",
          output: {
            indexed: result.indexed,
            failed: result.failed.length,
            failedIds: result.failed.slice(0, 10).map((failed) => failed.id),
          },
        });
      } catch (err: any) {
        await jobs().update(job.id, { status: "error", error: err?.message ?? String(err) });
      }
    })();
  };

  const runBackfillGraphNodeEmbeddingsJob = (job: Job): void => {
    void (async () => {
      try {
        await jobs().update(job.id, { status: "running" });
        const embeddingRuntime = (app as any).embeddingRuntime;
        const embedFn = embeddingRuntime?.hot?.getEmbeddingFunctionForModel?.("qwen3-embedding:0.6b");

        if (!embedFn) {
          throw new Error("embedding runtime not available");
        }

        const model = "qwen3-embedding:0.6b";
        const dims = 1024;
        const concurrency = 8;
        const batchSize = 1;
        const mongoBatch = 200;
        const maxChunkChars = 12000;

        const total = await app.mongo.events.countDocuments({
          kind: "graph.node",
          $or: [
            { text: { $type: "string", $ne: "" } },
            { "extra.preview": { $type: "string", $ne: "" } },
          ],
        });

        await jobs().update(job.id, {
          output: { phase: "streaming", completed: 0, total, chunked: 0 },
        });

        const normalizeExistingNodeId = (nodeId: string): string => nodeId.replace(/#chunk:\d+$/, "");
        const existingNodeIds = new Set<string>(
          (await app.mongo.graphNodeEmbeddings.distinct("node_id")).map((nodeId) => normalizeExistingNodeId(String(nodeId))),
        );

        const cursor = app.mongo.events
          .find(
            {
              kind: "graph.node",
              $or: [
                { text: { $type: "string", $ne: "" } },
                { "extra.preview": { $type: "string", $ne: "" } },
              ],
            },
            {
              projection: { _id: 1, message: 1, text: 1, project: 1, source: 1, extra: 1 },
              batchSize: mongoBatch,
            },
          )
          .sort({ _id: 1 });

        let completed = 0;
        let stored = 0;
        let failed = 0;
        let chunkedTotal = 0;
        let buffer: Array<{
          node_id: string;
          source_event_id: string;
          project: string | null;
          chunk_index: number;
          chunk_count: number;
          text: string;
          embedding: number[];
        }> = [];
        let pending: Promise<void>[] = [];

        const flush = async (): Promise<void> => {
          if (buffer.length === 0) return;
          const rows = buffer.splice(0, buffer.length);
          await upsertGraphNodeEmbeddings(app.mongo.graphNodeEmbeddings, rows.map((row) => ({
            node_id: row.node_id,
            source_event_id: row.source_event_id,
            project: row.project,
            embedding_model: model,
            embedding_dimensions: dims,
            embedding: row.embedding,
            chunk_index: row.chunk_index,
            chunk_count: row.chunk_count,
            text: row.text,
            updated_at: new Date(),
          })));
          stored += rows.length;
        };

        const chunkText = (text: string, maxChars: number): string[] => {
          if (text.length <= maxChars) return [text];
          const chunks: string[] = [];
          const overlap = Math.min(500, Math.floor(maxChars * 0.05));
          let start = 0;
          while (start < text.length) {
            let end = start + maxChars;
            if (end < text.length) {
              const lastBreak = text.lastIndexOf("\n", end);
              if (lastBreak > start + maxChars * 0.5) end = lastBreak;
            }
            chunks.push(text.slice(start, end).trim());
            start = end - overlap;
            if (start >= text.length) break;
          }
          return chunks.filter((chunk) => chunk.length > 0);
        };

        for await (const event of cursor) {
          const nodeId = (event.extra as any)?.node_id ?? event.message ?? event._id;
          if (!nodeId) {
            completed++;
            continue;
          }

          const text = String(event.text || (event.extra as any)?.preview || "");
          if (!text.trim()) {
            completed++;
            continue;
          }

          if (existingNodeIds.has(String(nodeId))) {
            completed++;
            continue;
          }

          const chunks = chunkText(text, maxChunkChars);
          if (chunks.length > 1) chunkedTotal++;

          const chunkPromises = chunks.map((chunkText_, chunkIndex) => {
            const chunkNodeId = chunks.length === 1
              ? String(nodeId)
              : `${nodeId}#chunk:${String(chunkIndex).padStart(4, "0")}`;

            const embedTimeoutMs = 30_000;
            const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
              new Promise<T>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("embed timeout")), ms);
                promise
                  .then((value) => {
                    clearTimeout(timer);
                    resolve(value);
                  })
                  .catch((error) => {
                    clearTimeout(timer);
                    reject(error);
                  });
              });

            return withTimeout(embedFn.generate([chunkText_]), embedTimeoutMs)
              .then(async (result: unknown) => {
                const [embedding] = result as [number[]];
                if (!Array.isArray(embedding) || embedding.length === 0) {
                  failed++;
                  return;
                }
                buffer.push({
                  node_id: chunkNodeId,
                  source_event_id: String(event._id),
                  project: event.project ?? null,
                  chunk_index: chunkIndex,
                  chunk_count: chunks.length,
                  text: chunkText_,
                  embedding,
                });
                if (buffer.length >= batchSize) await flush();
              })
              .catch(() => {
                failed++;
              });
          });

          const worker = Promise.all(chunkPromises).then(() => {});
          pending.push(worker);
          if (pending.length >= concurrency) {
            await Promise.all(pending.splice(0, pending.length));
          }

          completed++;
          if (completed % 100 === 0 || completed === total) {
            console.log(`[backfill] completed=${completed} stored=${stored} failed=${failed} chunked=${chunkedTotal} buffer=${buffer.length} total=${total}`);
            await jobs().update(job.id, {
              output: { phase: "embedding", completed, total, stored, failed, chunked: chunkedTotal },
            });
          }
        }

        if (pending.length > 0) await Promise.all(pending);
        await flush();

        await jobs().update(job.id, {
          status: "done",
          output: { completed, total, stored, failed, chunked: chunkedTotal },
        });
      } catch (err: any) {
        await jobs().update(job.id, {
          status: "error",
          error: err?.message ?? String(err),
        });
      }
    })();
  };

  const runBackfillGraphEdgesJob = (job: Job): void => {
    void (async () => {
      try {
        await jobs().update(job.id, { status: "running" });

        const total = await app.mongo.events.countDocuments({ kind: "graph.edge" });
        const mongoBatch = 1000;
        const writeBatch = 1000;

        await jobs().update(job.id, {
          output: { phase: "streaming", completed: 0, total, stored: 0, failed: 0 },
        });

        const cursor = app.mongo.events
          .find(
            { kind: "graph.edge" },
            {
              projection: { _id: 1, ts: 1, project: 1, source: 1, extra: 1 },
              batchSize: mongoBatch,
            },
          )
          .sort({ _id: 1 });

        let completed = 0;
        let stored = 0;
        let failed = 0;
        let buffer: Array<{
          source_node_id: string;
          target_node_id: string;
          edge_kind: string;
          layer?: string | null;
          project?: string | null;
          source?: string | null;
          data?: Record<string, unknown> | null;
          updated_at?: Date;
        }> = [];

        const flush = async (): Promise<void> => {
          if (buffer.length === 0) return;
          const rows = buffer.splice(0, buffer.length);
          await upsertGraphEdges(app.mongo.graphEdges, rows);
          stored += rows.length;
        };

        for await (const event of cursor) {
          const extra = (event.extra ?? {}) as Record<string, unknown>;
          const sourceNodeId = typeof extra.source_node_id === "string" ? extra.source_node_id.trim() : "";
          const targetNodeId = typeof extra.target_node_id === "string" ? extra.target_node_id.trim() : "";
          const edgeKindRaw = typeof extra.edge_type === "string"
            ? extra.edge_type
            : (typeof extra.edge_kind === "string" ? extra.edge_kind : "");
          const edgeKind = edgeKindRaw.trim();

          if (!sourceNodeId || !targetNodeId || !edgeKind || sourceNodeId === targetNodeId) {
            failed += 1;
            completed += 1;
            if (completed % 1000 === 0 || completed === total) {
              await jobs().update(job.id, {
                output: { phase: "streaming", completed, total, stored, failed },
              });
            }
            continue;
          }

          buffer.push({
            source_node_id: sourceNodeId,
            target_node_id: targetNodeId,
            edge_kind: edgeKind,
            layer: typeof extra.layer === "string" ? extra.layer : null,
            project: event.project ?? null,
            source: event.source ?? null,
            data: extra,
            updated_at: event.ts instanceof Date ? event.ts : new Date(),
          });

          if (buffer.length >= writeBatch) {
            await flush();
          }

          completed += 1;
          if (completed % 1000 === 0 || completed === total) {
            console.log(`[graph-edges-backfill] completed=${completed} stored=${stored} failed=${failed} total=${total}`);
            await jobs().update(job.id, {
              output: { phase: "streaming", completed, total, stored, failed },
            });
          }
        }

        await flush();

        await jobs().update(job.id, {
          status: "done",
          output: { completed, total, stored, failed },
        });
      } catch (err: any) {
        await jobs().update(job.id, {
          status: "error",
          error: err?.message ?? String(err),
        });
      }
    })();
  };

  const isRecoverableJobKind = (kind: string): boolean =>
    kind === "backfill.embeddings"
      || kind === "backfill.graph-node-embeddings"
      || kind === "backfill.graph-edges";

  const startRecoverableJob = (job: Job): boolean => {
    if (job.kind === "backfill.embeddings") {
      runBackfillEmbeddingsJob(job);
      return true;
    }
    if (job.kind === "backfill.graph-node-embeddings") {
      runBackfillGraphNodeEmbeddingsJob(job);
      return true;
    }
    if (job.kind === "backfill.graph-edges") {
      runBackfillGraphEdgesJob(job);
      return true;
    }
    return false;
  };

  const recoverJobsAfterRestart = async (): Promise<void> => {
    const activeJobs = jobs().list().filter((job) => job.status === "queued" || job.status === "running");
    if (activeJobs.length === 0) return;

    const latestRecoverableByKind = new Map<string, Job>();
    for (const job of activeJobs) {
      if (!isRecoverableJobKind(job.kind)) continue;
      latestRecoverableByKind.set(job.kind, job);
    }

    for (const job of activeJobs) {
      const latestRecoverable = latestRecoverableByKind.get(job.kind);
      if (latestRecoverable?.id === job.id) {
        const updated = await jobs().update(job.id, {
          status: "queued",
          output: {
            ...(job.output ?? {}),
            recovery: "resuming after process restart",
            resumed_at: new Date().toISOString(),
          },
          error: undefined,
        });
        if (updated) {
          console.log(`[jobs] resuming ${updated.kind} ${updated.id} after restart`);
          startRecoverableJob(updated);
        }
        continue;
      }

      const reason = latestRecoverable
        ? "Job interrupted by process restart; newer job for the same kind was resumed."
        : "Job interrupted by process restart; auto-resume is not implemented for this job kind.";
      await jobs().update(job.id, {
        status: "canceled",
        error: reason,
      });
    }
  };

  await recoverJobsAfterRestart();

  app.get("/jobs", async () => ({ ok: true, jobs: (app as any).jobs.list() }));

  app.get("/jobs/:id", async (req, reply) => {
    const { id } = req.params as any;
    const job = (app as any).jobs.get(id);
    if (!job) return reply.status(404).send({ error: "job not found" });
    return { ok: true, job };
  });

  // Import ChatGPT conversations
  app.post("/jobs/import/chatgpt", async (req) => {
    const body = (req.body as any) ?? {};
    const job = await (app as any).jobs.create("import.chatgpt", body);

    // Run async worker
    (async () => {
      try {
        await (app as any).jobs.update(job.id, { status: "running" });
        const { importChatGPTZipToSink } = await import("../../lib/importers/chatgpt.js");
        
        const filePath = body.filePath;
        if (!filePath) throw new Error("filePath required in job input");

        const result = await importChatGPTZipToSink(filePath, async (events) => {
          const response = await app.inject({
            method: "POST",
            url: "/v1/events",
            headers: {
              authorization: `Bearer ${(app as any).openplannerConfig.apiKey}`,
              "content-type": "application/json",
            },
            payload: JSON.stringify({ events }),
          });
          if (response.statusCode >= 400) {
            throw new Error(`failed to ingest imported events into mongodb backend: ${response.body}`);
          }
        }, async (count) => {
          await (app as any).jobs.update(job.id, { output: { processed: count } });
        });

        await (app as any).jobs.update(job.id, { status: "done", output: result });
      } catch (err: any) {
        console.error("Job failed:", err);
        await (app as any).jobs.update(job.id, { status: "error", error: err.message });
      }
    })();

    return { ok: true, job, note: "Job started in background" };
  });

  app.post("/jobs/import/opencode", async (req) => {
    const body = (req.body as any) ?? {};
    const job = await (app as any).jobs.create("import.opencode", body);
    return { ok: true, job, note: "Queued. Worker not implemented in skeleton." };
  });

  app.post("/jobs/compile/pack", async (req) => {
    const body = (req.body as any) ?? {};
    const job = await (app as any).jobs.create("compile.pack", body);
    return { ok: true, job, note: "Queued. Worker not implemented in skeleton." };
  });

  // Semantic compaction job
  app.post("/jobs/compact/semantic", async (req) => {
    const body = (req.body as any) ?? {};
    const job = await (app as any).jobs.create("compact.semantic", body);

    (async () => {
      try {
        await (app as any).jobs.update(job.id, { status: "running" });
        const { runSemanticCompactionMongo } = await import("../../lib/semantic-compaction.js");
        const cfg = (app as any).openplannerConfig;
        const output = await runSemanticCompactionMongo(app.mongo, cfg, body, (app as any).embeddingRuntime);
        await (app as any).jobs.update(job.id, { status: "done", output });
      } catch (err: any) {
        await (app as any).jobs.update(job.id, { status: "error", error: err?.message ?? String(err) });
      }
    })();

    return { ok: true, job, note: "Semantic compaction job started in background" };
  });

  // Full backfill job - rebuilds all embeddings
  app.post("/jobs/backfill/embeddings", async (req) => {
    const body = (req.body as any) ?? {};
    const job = await jobs().create("backfill.embeddings", body);
    runBackfillEmbeddingsJob(job);

    return { ok: true, job, note: "Embedding backfill job started in background" };
  });

  // Graph node embeddings backfill — populates graph_node_embeddings for all graph.node events
  app.post("/jobs/backfill/graph-node-embeddings", async (req) => {
    const body = (req.body as any) ?? {};
    const job = await jobs().create("backfill.graph-node-embeddings", body);
    runBackfillGraphNodeEmbeddingsJob(job);

    return { ok: true, job, note: "Graph node embeddings backfill started in background" };
  });

  // Structural graph edge backfill — populates graph_edges from historical graph.edge events
  app.post("/jobs/backfill/graph-edges", async (req) => {
    const body = (req.body as any) ?? {};
    const job = await jobs().create("backfill.graph-edges", body);
    runBackfillGraphEdgesJob(job);

    return { ok: true, job, note: "Graph edge backfill started in background" };
  });
};
