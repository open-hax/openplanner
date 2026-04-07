import type { FastifyPluginAsync } from "fastify";
import { JobQueue } from "../../lib/jobs.js";
import { paths } from "../../lib/paths.js";

export const jobRoutes: FastifyPluginAsync = async (app) => {
  if (!(app as any).jobs) {
    const cfg = (app as any).openplannerConfig;
    const p = paths(cfg.dataDir);
    const jq = new JobQueue(p.jobsPath);
    await jq.init();
    (app as any).jobs = jq;
  }

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
    const job = await (app as any).jobs.create("backfill.embeddings", body);

    (async () => {
      try {
        await (app as any).jobs.update(job.id, { status: "running" });
        const { batchIndexTextsInMongoVectors } = await import("../../lib/mongo-vectors.js");
        const cfg = (app as any).openplannerConfig;
        const embeddingRuntime = (app as any).embeddingRuntime;
        
        // Load all events from MongoDB
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
                await (app as any).jobs.update(job.id, { 
                  output: { phase, completed, total } 
                });
              }
            },
          },
        });

        await (app as any).jobs.update(job.id, { 
          status: "done", 
          output: { 
            indexed: result.indexed, 
            failed: result.failed.length,
            failedIds: result.failed.slice(0, 10).map(f => f.id),
          } 
        });
      } catch (err: any) {
        await (app as any).jobs.update(job.id, { status: "error", error: err?.message ?? String(err) });
      }
    })();

    return { ok: true, job, note: "Embedding backfill job started in background" };
  });
};
