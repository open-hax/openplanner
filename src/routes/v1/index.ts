import type { FastifyPluginAsync } from "fastify";
import { healthRoutes } from "./health.js";
import { blobRoutes } from "./blobs.js";
import { eventRoutes } from "./events.js";
import { documentRoutes } from "./documents.js";
import { gardenRoutes } from "./gardens.js";
import { searchRoutes } from "./search.js";
import { sessionRoutes } from "./sessions.js";
import { jobRoutes } from "./jobs.js";
import { metricsRoutes } from "./metrics.js";
import { graphRoutes } from "./graph.js";

export const v1Routes: FastifyPluginAsync = async (app) => {
  await app.register(healthRoutes);
  await app.register(blobRoutes);
  await app.register(eventRoutes);
  await app.register(documentRoutes);
  await app.register(gardenRoutes);
  await app.register(searchRoutes);
  await app.register(sessionRoutes);
  await app.register(jobRoutes);
  await app.register(metricsRoutes);
  await app.register(graphRoutes);
};
