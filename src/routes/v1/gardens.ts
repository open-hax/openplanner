import type { FastifyPluginAsync } from "fastify";

const gardens = [
  {
    garden_id: "query",
    title: "Query Garden",
    purpose: "Federated lake search and grounded synthesis",
    lakes: ["devel", "web", "bluesky", "cephalon-hive"],
    views: ["search", "answer"],
    actions: ["search", "synthesize"],
    outputs: ["grounded-answer", "raw-hits"],
  },
  {
    garden_id: "ingestion",
    title: "Ingestion Garden",
    purpose: "Source management, file routing, and background ingest",
    lakes: ["devel", "web", "bluesky"],
    views: ["sources", "jobs"],
    actions: ["create-source", "start-job", "cancel-job"],
    outputs: ["ingestion-jobs", "lake-population"],
  },
  {
    garden_id: "devel-deps-garden",
    title: "Dependency Garden",
    purpose: "Review workspace dependency topology and isolates",
    lakes: ["devel"],
    views: ["graph", "report"],
    actions: ["generate-graph", "focus-node", "find-isolates"],
    outputs: ["dependency-report", "isolates-list"],
  },
  {
    garden_id: "truth-workbench",
    title: "Truth Workbench",
    purpose: "Truth-resolution and control-plane review",
    lakes: ["devel", "bluesky", "cephalon-hive"],
    views: ["workbench", "control-plane", "receipts"],
    actions: ["review-truth", "inspect-vault", "inspect-receipts"],
    outputs: ["truth-ops-log", "vault-state"],
  },
];

export const gardenRoutes: FastifyPluginAsync = async (app) => {
  app.get("/gardens", async () => ({ ok: true, count: gardens.length, gardens }));

  app.get("/gardens/:id", async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    const garden = gardens.find((item) => item.garden_id === id);
    if (!garden) return reply.status(404).send({ error: "garden not found" });
    return { ok: true, garden };
  });
};
