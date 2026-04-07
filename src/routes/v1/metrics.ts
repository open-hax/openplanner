import type { FastifyPluginAsync } from "fastify";
import { gaugeSet } from "../../lib/metrics.js";

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/metrics/json", async () => {
    // MongoDB stats
    const eventsCount = await app.mongo.events.countDocuments();
    const compactedCount = await app.mongo.compacted.countDocuments();
    const hotVectorsCount = await app.mongo.hotVectors.countDocuments();
    const compactVectorsCount = await app.mongo.compactVectors.countDocuments();

    gaugeSet("openplanner_events_total", eventsCount, { backend: "mongodb" });
    gaugeSet("openplanner_compacted_total", compactedCount, { backend: "mongodb" });
    gaugeSet("openplanner_vectors_hot_total", hotVectorsCount, { backend: "mongodb" });
    gaugeSet("openplanner_vectors_compact_total", compactVectorsCount, { backend: "mongodb" });
    gaugeSet("openplanner_fts_enabled", 1, { backend: "mongodb" });

    return {
      ok: true,
      storageBackend: "mongodb",
      counts: {
        events: eventsCount,
        compacted: compactedCount,
        hotVectors: hotVectorsCount,
        compactVectors: compactVectorsCount,
      },
      ftsEnabled: true,
    };
  });
};
