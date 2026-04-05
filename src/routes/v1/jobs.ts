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

  // Stubs: create jobs (worker execution is out-of-scope)
  app.post("/jobs/import/chatgpt", async (req) => {
    const body = (req.body as any) ?? {};
    const job = await (app as any).jobs.create("import.chatgpt", body);

    // Run async worker
    (async () => {
      try {
        await (app as any).jobs.update(job.id, { status: "running" });
        const { importChatGPTZip, importChatGPTZipToSink } = await import("../../lib/importers/chatgpt.js");
        
        // Assume input has 'filePath'
        const filePath = body.filePath;
        if (!filePath) throw new Error("filePath required in job input");

        const storageBackend = (app as any).storageBackend ?? "duckdb";
        const result = storageBackend === "mongodb"
          ? await importChatGPTZipToSink(filePath, async (events) => {
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
            })
          : await importChatGPTZip(filePath, (app as any).duck, async (count) => {
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

  app.post("/jobs/compact/semantic", async (req) => {
    const body = (req.body as any) ?? {};
    const job = await (app as any).jobs.create("compact.semantic", body);

    (async () => {
      try {
        await (app as any).jobs.update(job.id, { status: "running" });
        const { runSemanticCompaction, runSemanticCompactionMongo } = await import("../../lib/semantic-compaction.js");
        const cfg = (app as any).openplannerConfig;
        const storageBackend = (app as any).storageBackend ?? "duckdb";
        const output = storageBackend === "mongodb"
          ? await runSemanticCompactionMongo(app.mongo, cfg, body, (app as any).embeddingRuntime)
          : await runSemanticCompaction(app.duck, app.chroma, cfg, body);
        await (app as any).jobs.update(job.id, { status: "done", output });
      } catch (err: any) {
        await (app as any).jobs.update(job.id, { status: "error", error: err?.message ?? String(err) });
      }
    })();

    return { ok: true, job, note: "Semantic compaction job started in background" };
  });
};
